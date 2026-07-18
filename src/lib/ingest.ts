import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { communities, events, sources } from "@/db/schema";
import {
  computeDedupKey,
  contentMatches,
  maxStartTime,
  normalizeEvent,
  validateEvent,
  type ExtractedEvent,
} from "./contract";
import { fetchPage, isPublicHttpUrl } from "./fetchPage";
import { emit } from "./runEvents";

// Feeds and APIs rarely embed an image, so we fetch each imageless event's own
// detail page and read its og:image. Bounded so a large run can't fan out.
const MAX_IMAGE_FETCHES = 24;

// Structural minimums. An event missing any of these is not a completable
// event, so it is auto-rejected at ingest instead of clogging the review queue.
// Softer gaps (image, contact, description length) stay in review to be fixed.
const HARD_ISSUES = new Set([
  "title_missing",
  "sessions_missing",
  "session_start_invalid",
  "sponsors_missing",
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

  // Existing events in this community used for content-based duplicate checking.
  const existing = await db
    .select({
      id: events.id,
      title: events.title,
      location: events.location,
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

  let imageFetches = 0;

  for (const raw of rawEvents) {
    const e: ExtractedEvent = normalizeEvent(raw);

    // Every event must carry an image. When the source did not supply one,
    // fetch the event's own detail/registration page and read its og:image.
    if (!e.imageCdnUrl && imageFetches < MAX_IMAGE_FETCHES) {
      const detailUrl = [e.website, e.registrationUrl, e.urlLink].find(
        (u): u is string => !!u && isPublicHttpUrl(u),
      );
      if (detailUrl) {
        imageFetches++;
        try {
          const page = await fetchPage(detailUrl, 12_000);
          if (page.image) {
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

    // 2) content match: date + location first, then title
    if (!duplicateOf) {
      for (const x of existing) {
        const xs = Array.isArray(x.sessions)
          ? (x.sessions as { startTime?: number }[]).map((s) => Number(s.startTime)).filter(Boolean)
          : [];
        const m = contentMatches(
          { title: e.title, startTimes, location: e.location ?? null },
          { title: x.title ?? "", startTimes: xs, location: x.location ?? null },
        );
        if (m.match) {
          duplicateOf = x.id;
          dupReason = m.reason;
          break;
        }
      }
    }

    if (duplicateOf) {
      await emit(runId, "dedup_outcome", `Duplicate of #${duplicateOf} (${dupReason})`, {
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
    const status = duplicateOf
      ? "duplicate"
      : hardIssues.length
        ? "auto_rejected"
        : "pending";
    if (issues.length) counts.invalid++;
    if (duplicateOf) counts.duplicate++;
    if (!duplicateOf && hardIssues.length) counts.autoRejected++;

    const rejectionReason = duplicateOf
      ? null
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
      contactEmail: e.contactEmail,
      phone: e.phone,
      dedupKey,
      provenance: source.sourceKind === "aggregator" ? "aggregator" : "original_org",
      duplicateOfEventId: duplicateOf,
      rejectionReason,
      calendarSourceName: source.calendarSourceName ?? source.name,
      calendarSourceUrl: source.calendarSourceUrl ?? source.url,
    });
    const newId = (res as { insertId: number }).insertId;
    if (status === "pending") {
      counts.inserted++;
      existingByKey.set(dedupKey, newId);
    }

    await emit(
      runId,
      "queue_outcome",
      duplicateOf
        ? `Kept as duplicate (#${newId})`
        : status === "auto_rejected"
          ? `Auto-rejected as incomplete (#${newId}): ${hardIssues.join(", ")}`
          : issues.length
            ? `Sent to review, needs fields before publish (#${newId})`
            : `Sent to review (#${newId})`,
      { eventId: newId, status, mode, issues },
    );
  }

  return counts;
}
