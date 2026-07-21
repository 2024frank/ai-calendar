import "server-only";
import { createHash, randomBytes } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { communities, events, loginTokens, sources, users } from "@/db/schema";
import {
  computeDedupKey,
  contentMatches,
  maxStartTime,
  normalizeEvent,
  validateEvent,
  type ExtractedEvent,
} from "./contract";
import { fetchPage, hasImageExtension, isGenericImage, isPublicHttpUrl } from "./fetchPage";
import { mergePosterImages } from "./mergePosters";
import { fetchDestinationInventory } from "./inventory";
import { publishEvent } from "./publishEvent";
import { sendNewEventsDigest } from "./email";
import { emit } from "./runEvents";

// Feeds and APIs rarely embed an image, so we fetch each imageless event's own
// detail page and read its og:image. Bounded so a large run can't fan out.
const MAX_IMAGE_FETCHES = 24;

// Structural minimums. An event missing any of these is not a real, publishable
// event, so it is auto-rejected at ingest instead of entering the review queue.
// Every real event has a picture, so a missing image disqualifies it outright.
// A missing image disqualifies an event outright: every real event has one.
// Contact details are still required before publishing, but some organizations
// genuinely publish no phone, so a reviewer fills those in rather than losing
// the event entirely.
const HARD_ISSUES = new Set([
  "title_missing",
  "description_too_short",
  "sessions_missing",
  "session_start_invalid",
  "sponsors_missing",
  "post_type_missing",
  "image_missing",
  "location_required",
]);

export type IngestCounts = {
  found: number;
  inserted: number;
  duplicate: number;
  invalid: number;
  autoRejected: number;
};

type SourceRow = typeof sources.$inferSelect;
type CommunityRow = typeof communities.$inferSelect;

export function effectiveMode(source: SourceRow, community: CommunityRow) {
  return source.mode ?? community.defaultMode;
}

/**
 * Persist extracted candidates. Nothing is ever silently dropped:
 * invalid or ambiguous events still land in the review queue.
 */
export async function ingestEvents(
  runId: number,
  source: SourceRow,
  community: CommunityRow,
  rawEvents: Record<string, unknown>[],
): Promise<IngestCounts> {
  const counts: IngestCounts = {
    found: rawEvents.length,
    inserted: 0,
    duplicate: 0,
    invalid: 0,
    autoRejected: 0,
  };
  const mode = effectiveMode(source, community);
  const newlyPending: { title: string; when: string }[] = [];

  // Existing events in this community used for content-based duplicate checking.
  const existing = await db
    .select({
      id: events.id,
      title: events.title,
      location: events.location,
      description: events.description,
      sessions: events.sessions,
      dedupKey: events.dedupKey,
    })
    .from(events)
    .where(
      and(
        eq(events.communityId, source.communityId),
        inArray(events.status, ["pending", "approved", "submitted"]),
      ),
    )
    .orderBy(desc(events.id))
    .limit(400);

  const existingByKey = new Map(existing.filter((e) => e.dedupKey).map((e) => [e.dedupKey!, e.id]));

  // What the endpoint already published, so we never repost it.
  const remoteInventory = await fetchDestinationInventory(source.communityId);
  if (remoteInventory.length) {
    await emit(runId, "dedup_outcome", `Checked against ${remoteInventory.length} live post(s) on the endpoint`, {
      inventory: remoteInventory.length,
    });
  }

  let imageFetches = 0;
  // Each event needs its OWN picture. One URL reused across events is site
  // furniture (a logo or share graphic), not an event photo.
  const usedImages = new Set<string>();
  const listingUrls = new Set(
    [source.url, ...(Array.isArray(source.startUrls) ? (source.startUrls as string[]) : [])]
      .filter(Boolean)
      .map((u) => String(u).replace(/\/+$/, "")),
  );
  const isListing = (u: string) => listingUrls.has(u.replace(/\/+$/, ""));

  // Bulk image rescue BEFORE the main loop: every event still missing a
  // picture gets its own page fetched (concurrently) and the page's share
  // image (og:image) used. This covers an agent that shipped events without
  // their photos even though the pages have them.
  const needingImage = rawEvents.filter((r) => {
    const has =
      (typeof r.imageCdnUrl === "string" && r.imageCdnUrl) ||
      (typeof r.imageB64 === "string" && r.imageB64) ||
      (typeof r.imageData === "string" && r.imageData) ||
      (Array.isArray(r.imageUrls) && r.imageUrls.length);
    return !has;
  });
  if (needingImage.length) {
    let rescued = 0;
    const BATCH = 8;
    for (let i = 0; i < needingImage.length; i += BATCH) {
      await Promise.all(
        needingImage.slice(i, i + BATCH).map(async (r) => {
          const detail = [r.calendarSourceUrl, r.website, r.registrationUrl, r.urlLink].find(
            (u): u is string => typeof u === "string" && isPublicHttpUrl(u) && !isListing(u),
          );
          if (!detail) return;
          try {
            const page = await fetchPage(detail, 10_000);
            if (page.image && !isGenericImage(page.image)) {
              r.imageCdnUrl = page.image;
              rescued++;
            }
          } catch {
            /* leave it; validation reports image_missing */
          }
        }),
      );
    }
    await emit(
      runId,
      "image_enriched",
      `Fetched ${needingImage.length} event page(s) for missing pictures; found ${rescued}`,
      { missing: needingImage.length, rescued },
    );
  }

  for (const raw of rawEvents) {
    const e: ExtractedEvent = normalizeEvent(raw, community.timezone);

    // Drop site furniture the agent may still have picked up.
    if (e.imageCdnUrl && isGenericImage(e.imageCdnUrl)) e.imageCdnUrl = null;
    // Agent-supplied image bytes (imageB64, for bot-walled hosts): keep only a
    // real image, checked by magic bytes, capped at 4 MB.
    if (e.imageData) {
      const head = Buffer.from(e.imageData.slice(0, 16), "base64");
      const realImage =
        (head[0] === 0xff && head[1] === 0xd8) || // JPEG
        (head[0] === 0x89 && head[1] === 0x50) || // PNG
        (head[0] === 0x52 && head[1] === 0x49) || // WebP (RIFF)
        (head[0] === 0x47 && head[1] === 0x49); // GIF
      if (!realImage || e.imageData.length > 5_600_000) e.imageData = null;
    }
    if (e.imageData) e.imageCdnUrl = e.imageCdnUrl ?? null;

    // Several pictures for one item (e.g. two movie posters) -> merge into one.
    const pics = (e.imageUrls ?? []).filter((u) => !isGenericImage(u));
    if (!e.imageData && pics.length > 1) {
      try {
        const buf = await mergePosterImages(pics);
        if (buf) {
          e.imageData = buf.toString("base64");
          e.imageCdnUrl = null;
          await emit(runId, "image_enriched", `Merged ${pics.length} pictures for ${e.title}`, {
            title: e.title,
            count: pics.length,
          });
        }
      } catch {
        /* fall through to the single-image handling below */
      }
    }
    // A single picture in the list is just the image.
    if (!e.imageData && !e.imageCdnUrl && pics.length === 1) e.imageCdnUrl = pics[0];

    // CommunityHub needs the image URL to end in a real extension. If our chosen
    // image is a query-based or extension-less URL (e.g. a Veezi poster), pull it
    // into imageData so it serves from our own /image.jpg endpoint.
    if (!e.imageData && e.imageCdnUrl && !hasImageExtension(e.imageCdnUrl)) {
      try {
        const buf = await mergePosterImages([e.imageCdnUrl]);
        if (buf) {
          e.imageData = buf.toString("base64");
          e.imageCdnUrl = null;
        }
      } catch {
        /* leave the URL as-is; a reviewer can replace it */
      }
    }

    // Only enrich from a page belonging to THIS event. The source's own listing
    // page is shared by every event, so its og:image is not a per-event photo.
    if (!e.imageCdnUrl && imageFetches < MAX_IMAGE_FETCHES) {
      const detailUrl = [e.calendarSourceUrl, e.registrationUrl, e.urlLink, e.website].find(
        (u): u is string => !!u && isPublicHttpUrl(u) && !isListing(u),
      );
      if (detailUrl) {
        imageFetches++;
        try {
          const page = await fetchPage(detailUrl, 12_000);
          if (page.image && !isGenericImage(page.image)) {
            e.imageCdnUrl = page.image;
            await emit(runId, "image_enriched", `Image found for ${e.title}`, {
              title: e.title,
              image: page.image,
              from: detailUrl,
            });
          }
        } catch {
          /* image enrichment is best-effort; missing image is flagged below */
        }
      }
    }

    // Never let two events share one picture.
    if (e.imageCdnUrl) {
      if (usedImages.has(e.imageCdnUrl)) {
        await emit(runId, "image_rejected", `Shared image dropped for ${e.title}`, {
          title: e.title,
          image: e.imageCdnUrl,
          reason: "same image already used by another event in this run",
        });
        e.imageCdnUrl = null;
      } else {
        usedImages.add(e.imageCdnUrl);
      }
    }

    // Fall back to the organization's standing contact details so a whole run
    // is not blocked just because a listing page omits them per event.
    if (!e.contactEmail && source.orgContactEmail) e.contactEmail = source.orgContactEmail;
    if (!e.phone && source.orgPhone) e.phone = source.orgPhone;
    if (!e.website) e.website = source.orgWebsite ?? source.calendarSourceUrl ?? source.url;
    if (!e.sponsors.length && (source.orgName ?? source.name)) {
      e.sponsors = [source.orgName ?? source.name];
    }

    const issues = validateEvent(e);
    const dedupKey = computeDedupKey(e);
    const startTimes = e.sessions.map((s) => s.startTime);

    await emit(
      runId,
      "candidate_validated",
      `${e.title || "(untitled)"} — ${issues.length ? `${issues.length} issue(s)` : "valid"}`,
      { title: e.title, valid: issues.length === 0, issues },
    );

    // 1) exact same-source signature
    let duplicateOf: number | null = existingByKey.get(dedupKey) ?? null;
    let dupReason = duplicateOf ? "identical title and date signature" : "";

    // The agent judged this a duplicate of an event in this calendar. The agent
    // reads both systems' content and is the authority on semantic matches.
    const agentDupId = Number((raw as Record<string, unknown>)._agentDuplicateOfId);
    if (!duplicateOf && Number.isInteger(agentDupId) && agentDupId > 0) {
      if (existing.some((x) => x.id === agentDupId)) {
        duplicateOf = agentDupId;
        dupReason = "the agent matched it to this event";
      }
    }

    // 2) content match on title + start time + location + short description
    if (!duplicateOf) {
      for (const x of existing) {
        const xs = Array.isArray(x.sessions)
          ? (x.sessions as { startTime?: number }[]).map((s) => Number(s.startTime)).filter(Boolean)
          : [];
        const m = contentMatches(
          { title: e.title, startTimes, location: e.location ?? null, description: e.description },
          { title: x.title ?? "", startTimes: xs, location: x.location ?? null, description: x.description ?? null },
        );
        if (m.match) {
          duplicateOf = x.id;
          dupReason = m.reason;
          break;
        }
      }
    }

    // 3) already published on the community's endpoint
    let remoteDup = false;
    let duplicateOfUrl: string | null = null;
    // The agent may have already matched this to a CommunityHub post and told
    // us its URL; keep it so the reviewer can open what it duplicates.
    const agentDup = (raw as Record<string, unknown>)._agentDuplicateOf;
    if (typeof agentDup === "string" && /^https?:\/\//i.test(agentDup)) {
      // Post pages are /calendar/post/<numeric id>; a hash there is a dead
      // link (the agent grabbed the token), so drop it rather than store it.
      const tail = agentDup.split("/calendar/post/")[1]?.replace(/\/+$/, "");
      duplicateOfUrl = tail !== undefined && !/^\d+$/.test(tail) ? null : agentDup;
      remoteDup = true;
      dupReason = "the agent matched it to this CommunityHub post";
    }
    if (!duplicateOf) {
      for (const r of remoteInventory) {
        const m = contentMatches(
          { title: e.title, startTimes, location: e.location ?? null, description: e.description },
          { title: r.title, startTimes: r.startTimes, location: r.location, description: r.description },
        );
        if (m.match) {
          remoteDup = true;
          dupReason = `already on the endpoint (${m.reason})`;
          duplicateOfUrl = r.url ?? duplicateOfUrl;
          break;
        }
      }
    }

    if (duplicateOf || remoteDup) {
      await emit(runId, "dedup_outcome", `Duplicate${duplicateOf ? ` of #${duplicateOf}` : ""} (${dupReason})`, {
        title: e.title,
        duplicateOfEventId: duplicateOf,
        reason: dupReason,
      });
    } else {
      await emit(runId, "dedup_outcome", `Unique: ${e.title}`, { title: e.title, unique: true });
    }

    // An event missing a structural minimum (title, a real date, a sponsor) is
    // not completable, so it is auto-rejected rather than shown for review.
    const hardIssues = issues.filter((i) => HARD_ISSUES.has(i));

    // Restricted mode keeps every completable event in review. Duplicates are
    // preserved. Structurally-broken events are kept as auto_rejected.
    const status = duplicateOf || remoteDup
      ? "duplicate"
      : hardIssues.length
        ? "auto_rejected"
        : "pending";
    if (issues.length) counts.invalid++;
    if (duplicateOf || remoteDup) counts.duplicate++;
    if (!duplicateOf && hardIssues.length) counts.autoRejected++;

    const rejectionReason = duplicateOf || remoteDup
      ? (remoteDup ? `Already published: ${dupReason}` : null)
      : hardIssues.length
        ? `Auto-rejected (incomplete): ${hardIssues.join(", ")}`
        : issues.length
          ? `Missing before publish: ${issues.join(", ")}`
          : null;

    const [res] = await db.insert(events).values({
      communityId: source.communityId,
      sourceId: source.id,
      status,
      eventType: e.eventType,
      title: e.title,
      description: e.description,
      extendedDescription: e.extendedDescription,
      sessions: e.sessions,
      startTimeMax: maxStartTime(e),
      locationType: e.locationType,
      location: e.location,
      urlLink: e.urlLink,
      displayType: e.display,
      postTypeIds: e.postTypeId,
      sponsors: e.sponsors,
      website: e.website,
      registrationUrl: e.registrationUrl,
      imageCdnUrl: e.imageCdnUrl,
      imageData: e.imageData ?? null,
      placeName: e.placeName ?? null,
      roomNum: e.roomNum ?? null,
      buttons: e.buttons?.length ? e.buttons : null,
      fieldNotes: e.fieldNotes ?? null,
      contactEmail: e.contactEmail,
      phone: e.phone,
      dedupKey,
      provenance: source.sourceKind === "aggregator" ? "aggregator" : "original_org",
      duplicateOfEventId: duplicateOf,
      duplicateOfUrl,
      rejectionReason,
      calendarSourceName: source.calendarSourceName ?? source.name,
      // Prefer this event's own page so a reviewer can open the original and
      // trace or fix it; fall back to the source's listing page.
      calendarSourceUrl: e.calendarSourceUrl ?? source.calendarSourceUrl ?? source.url,
    });
    const newId = (res as { insertId: number }).insertId;

    // Links that need the row's own id: the deep link back to this reviewer
    // record, and (for images we generated) a real URL for the picture.
    const appUrl = process.env.APP_URL || "https://ai-calendar.uhurued.com";
    const patch: Record<string, unknown> = {
      ingestedPostUrl: `${appUrl}/review/${newId}`,
    };
    if (e.imageData && !e.imageCdnUrl) {
      patch.imageCdnUrl = `${appUrl}/api/events/${newId}/image.jpg`;
    }
    await db.update(events).set(patch).where(eq(events.id, newId));
    if (e.imageData && !e.imageCdnUrl) {
      const served = `${appUrl}/api/events/${newId}/image.jpg`;
      await emit(runId, "image_enriched", `Merged image published at ${served}`, {
        eventId: newId,
        image: served,
      });
    }
    if (status === "pending") {
      counts.inserted++;
      existingByKey.set(dedupKey, newId);

      if (mode === "unrestricted") {
        // No human review: send it straight to CommunityHub. On success the
        // event becomes 'submitted'; on failure it stays pending for a person.
        try {
          const pub = await publishEvent(newId);
          await emit(
            runId,
            "queue_outcome",
            pub.state === "succeeded"
              ? `Auto-submitted to CommunityHub (#${newId})`
              : `Auto-submit ${pub.state}, left for review (#${newId}): ${pub.message}`,
            { eventId: newId, publish: pub.state },
          );
        } catch {
          await emit(runId, "queue_outcome", `Auto-submit failed, left for review (#${newId})`, {
            eventId: newId,
          });
        }
      } else {
        // Restricted: it waits for a reviewer. Collect for the digest email.
        const first = e.sessions[0]?.startTime;
        newlyPending.push({
          title: e.title,
          when: first
            ? new Date(first * 1000).toLocaleString("en-US", {
                timeZone: community.timezone,
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : "date to set",
        });
      }
    }

    await emit(
      runId,
      "queue_outcome",
      duplicateOf || remoteDup
        ? `Kept as duplicate (#${newId})`
        : status === "auto_rejected"
          ? `Auto-rejected as incomplete (#${newId}): ${hardIssues.join(", ")}`
          : issues.length
            ? `Sent to review, needs fields before publish (#${newId})`
            : `Sent to review (#${newId})`,
      { eventId: newId, status, mode, issues },
    );
  }

  if (newlyPending.length) {
    await notifyReviewers(source, community, newlyPending);
  }

  return counts;
}

/** Email the community's reviewers a digest of the new pending events. */
async function notifyReviewers(
  source: SourceRow,
  community: CommunityRow,
  events: { title: string; when: string }[],
) {
  try {
    const recipients = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        and(
          eq(users.status, "active"),
          eq(users.communityId, community.id),
          inArray(users.role, ["reviewer", "community_admin"]),
        ),
      );
    const appUrl = process.env.APP_URL || "https://ai-calendar.uhurued.com";
    for (const r of recipients) {
      if (!r.email) continue;
      // A one-time, 24h login link straight to the review queue, so the reviewer
      // does not have to sign in first. Consumed on first use, then invalid.
      const rawToken = randomBytes(32).toString("hex");
      await db.insert(loginTokens).values({
        userId: r.id,
        kind: "magic",
        tokenHash: createHash("sha256").update(rawToken).digest("hex"),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      const reviewUrl = `${appUrl}/api/auth/verify?token=${rawToken}&next=${encodeURIComponent("/review")}`;
      await sendNewEventsDigest(r.email, {
        communityName: community.name,
        sourceName: source.name,
        events,
        reviewUrl,
      });
    }
  } catch {
    /* a digest failure must never fail the run */
  }
}
