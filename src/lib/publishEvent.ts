import "server-only";
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { destinations, events, publishSubmissions, sources } from "@/db/schema";
import { POST_TYPE_IDS } from "./taxonomy";

type EventRow = typeof events.$inferSelect;

export type PublishResult = {
  ok: boolean;
  state: "succeeded" | "failed" | "unknown" | "skipped";
  message: string;
  remoteId?: string | null;
};

/** Build the exact CommunityHub payload for an event. */
export function buildPayload(ev: EventRow, publishEmail: string, appUrl: string) {
  const sessions = (ev.sessions ?? []) as { startTime: number; endTime: number }[];
  const postTypeId = ((ev.postTypeIds ?? []) as number[]).filter((id) => POST_TYPE_IDS.includes(id));
  const buttons = (ev.buttons ?? []) as { title: string; link: string }[];
  const screensIds = (ev.screensIds ?? []) as number[];

  // An image we generated ourselves is served from this app.
  const image = ev.imageData ? `${appUrl}/api/events/${ev.id}/image.jpg` : (ev.imageCdnUrl ?? undefined);

  const payload: Record<string, unknown> = {
    eventType: ev.eventType ?? "ot",
    email: publishEmail,
    subscribe: true,
    public: "1",
    title: ev.title ?? "",
    description: ev.description ?? "",
    sponsors: (ev.sponsors ?? []) as string[],
    postTypeId,
    sessions,
    locationType: ev.locationType ?? "ne",
    display: ev.displayType ?? "all",
  };

  if (ev.extendedDescription) payload.extendedDescription = ev.extendedDescription;
  if (ev.locationType === "ph2" || ev.locationType === "bo") payload.location = ev.location ?? "";
  if (ev.locationType === "on" || ev.locationType === "bo") payload.urlLink = ev.urlLink ?? "";
  if (ev.placeName) payload.placeName = ev.placeName;
  if (ev.roomNum) payload.roomNum = ev.roomNum;
  if (ev.displayType === "ss") payload.screensIds = screensIds;
  if (buttons.length) payload.buttons = buttons;
  if (ev.website) payload.website = ev.website;
  if (ev.contactEmail) payload.contactEmail = ev.contactEmail;
  if (ev.phone) payload.phone = ev.phone;
  if (image) payload.image_cdn_url = image;
  if (ev.calendarSourceName) payload.calendarSourceName = ev.calendarSourceName;
  if (ev.calendarSourceUrl) payload.calendarSourceUrl = ev.calendarSourceUrl;
  // The reviewer deep link recorded on the event, so the published post
  // points back at the record behind it.
  payload.ingestedPostUrl = ev.ingestedPostUrl ?? `${appUrl}/review/${ev.id}`;

  return payload;
}

/**
 * Turn CommunityHub's answer into something a reviewer can act on.
 *
 * A failure used to arrive as a raw PHP stack trace, which tells a reviewer
 * nothing and looks like our bug. The known ones are named; anything else keeps
 * a trimmed version of the original so it can still be reported upstream.
 */
function explainPublishFailure(status: number, body: string): string {
  if (/setGooglePlaceId\(\)|googlePlaceId/i.test(body)) {
    return (
      "CommunityHub could not place this address on the map and its server stopped " +
      "on that instead of continuing. Editing the address to a plain street address " +
      "(no suite or unit number) usually gets it through. This is a fault on the " +
      "CommunityHub side, not with this event."
    );
  }
  if (status === 401 || status === 403) {
    return "CommunityHub refused the request. The endpoint credentials for this community need checking.";
  }
  if (status === 413) return "CommunityHub refused this as too large, most likely the image.";
  if (/failed to download image/i.test(body)) {
    return (
      "CommunityHub could not download this event's picture from the site it lives on. " +
      "We tried again with the picture served from here and that did not work either, " +
      "so the image needs replacing before this can publish."
    );
  }
  if (status >= 500) {
    return `CommunityHub had a server error (${status}) and did not accept this. It is worth trying again shortly. ${body.replace(/<[^>]*>/g, " ").slice(0, 160)}`;
  }
  return `CommunityHub rejected this (${status}). ${body.replace(/<[^>]*>/g, " ").slice(0, 200)}`;
}

const permanentFailure = (status: number) => status === 400 || status === 401 || status === 403 || status === 422;

/**
 * Send an approved event to the community's destination, exactly once.
 *
 * Idempotency: a submission row is claimed on (event, destination, payload
 * hash) before the request goes out. A network error keeps the row in `sending`
 * and is NOT retried automatically, because CommunityHub may have committed the
 * post even though the response never reached us. Retrying blindly is how you
 * get a duplicate public post.
 */
/**
 * Pull an image onto our own domain.
 *
 * CommunityHub downloads the picture from whatever URL we hand it, and some
 * hosts refuse its server even when they serve everyone else. Oberlin's file
 * host is one: the image fetches fine from here and 500s for them. Rather than
 * lose the event over it, the bytes are stored on the event and the URL is
 * swapped for one on this app, which CommunityHub can always reach.
 */
async function rehostImage(eventId: number, url: string, appUrl: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Sanity-check it really is an image before we serve it as one.
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isGif = buf[0] === 0x47 && buf[1] === 0x49;
    const isWebp = buf.subarray(8, 12).toString() === "WEBP";
    if (!buf.length || !(isJpeg || isPng || isGif || isWebp)) return null;
    await db
      .update(events)
      .set({ imageData: buf.toString("base64") })
      .where(eq(events.id, eventId));
    return `${appUrl}/api/events/${eventId}/image.jpg`;
  } catch {
    return null;
  }
}

export async function publishEvent(
  eventId: number,
  finalStatus: "approved" | "submitted" | "published" = "submitted",
  /** Set once we have already swapped the image, so this cannot loop. */
  imageRehosted = false,
): Promise<PublishResult> {
  const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!ev) return { ok: false, state: "failed", message: "Event not found." };

  // Which destination: the source's own, else the community's default.
  const [src] = ev.sourceId
    ? await db.select().from(sources).where(eq(sources.id, ev.sourceId)).limit(1)
    : [undefined];
  const destId = src?.destinationId ?? null;
  const [dest] = destId
    ? await db.select().from(destinations).where(eq(destinations.id, destId)).limit(1)
    : await db
        .select()
        .from(destinations)
        .where(and(eq(destinations.communityId, ev.communityId), eq(destinations.active, true)))
        .limit(1);

  // No endpoint configured: the event simply lives in this community's calendar.
  if (!dest) {
    return { ok: true, state: "skipped", message: "No endpoint configured; kept in the AI calendar." };
  }

  const cfg = (typeof dest.config === "string" ? JSON.parse(dest.config) : dest.config) as {
    submit_url?: string;
  };
  if (!cfg?.submit_url) {
    return { ok: false, state: "failed", message: "This destination has no submit URL." };
  }

  const appUrl = process.env.APP_URL || "https://ai-calendar.uhurued.com";
  const payload = buildPayload(ev, process.env.PUBLISH_EMAIL || "", appUrl);
  const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");

  // Already sent this exact payload? Never send it twice.
  const [existing] = await db
    .select()
    .from(publishSubmissions)
    .where(
      and(
        eq(publishSubmissions.eventId, ev.id),
        eq(publishSubmissions.destinationId, dest.id),
        eq(publishSubmissions.payloadHash, payloadHash),
      ),
    )
    .limit(1);

  if (existing?.state === "succeeded") {
    return { ok: true, state: "succeeded", message: "Already published.", remoteId: existing.externalPostId };
  }
  if (existing?.state === "sending") {
    return {
      ok: false,
      state: "unknown",
      message: "A previous send is unresolved. Check CommunityHub before retrying.",
    };
  }

  if (existing) {
    await db
      .update(publishSubmissions)
      .set({ state: "sending", error: null })
      .where(eq(publishSubmissions.id, existing.id));
  } else {
    await db.insert(publishSubmissions).values({
      eventId: ev.id,
      destinationId: dest.id,
      payloadHash,
      state: "sending",
      payload,
    });
  }

  let res: Response;
  try {
    res = await fetch(cfg.submit_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    // Ambiguous: keep `sending` so nothing retries on its own.
    await db
      .update(publishSubmissions)
      .set({ error: { message } })
      .where(
        and(
          eq(publishSubmissions.eventId, ev.id),
          eq(publishSubmissions.payloadHash, payloadHash),
        ),
      );
    return { ok: false, state: "unknown", message: `Could not reach CommunityHub: ${message}` };
  }

  const body = await res.text();
  if (!res.ok) {
    const permanent = permanentFailure(res.status);
    await db
      .update(publishSubmissions)
      .set({
        // Only a definite client rejection is safe to mark failed and retry later.
        state: permanent ? "failed" : "accepted_unreconciled",
        error: { status: res.status, body: body.slice(0, 500) },
      })
      .where(
        and(eq(publishSubmissions.eventId, ev.id), eq(publishSubmissions.payloadHash, payloadHash)),
      );
    // CommunityHub could not fetch the picture from its original host. Put the
    // image on our own domain and send it again; this is the whole failure for
    // an event that is otherwise ready.
    if (!imageRehosted && /failed to download image/i.test(body) && ev.imageCdnUrl) {
      const hosted = await rehostImage(ev.id, ev.imageCdnUrl, appUrl);
      if (hosted) {
        await db.update(events).set({ imageCdnUrl: hosted }).where(eq(events.id, ev.id));
        return publishEvent(eventId, finalStatus, true);
      }
    }

    return {
      ok: false,
      state: permanent ? "failed" : "unknown",
      message: explainPublishFailure(res.status, body),
    };
  }

  let remoteId: string | null = null;
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const raw = json.id ?? json.post_id ?? (json.post as Record<string, unknown>)?.id;
    if (raw != null) remoteId = String(raw);
  } catch {
    /* a non-JSON success body is still a success */
  }

  await db
    .update(publishSubmissions)
    .set({ state: "succeeded", externalPostId: remoteId, error: null })
    .where(
      and(eq(publishSubmissions.eventId, ev.id), eq(publishSubmissions.payloadHash, payloadHash)),
    );
  // The status reflects the PATH, not just "reached the hub". "approved" means
  // a person here read it. "submitted" means nobody here did and it is waiting
  // on CommunityHub. "published" means nobody checked it at either end. All
  // three sit on CommunityHub; only the accountability differs.
  await db.update(events).set({ status: finalStatus }).where(eq(events.id, ev.id));

  return { ok: true, state: "succeeded", message: "Sent to CommunityHub.", remoteId };
}
