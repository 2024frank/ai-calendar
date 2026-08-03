import "server-only";
import { createHash } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { communities, events, publishSubmissions, sources } from "@/db/schema";
import {
  fetchPublicBytes,
  readResponseBytesLimited,
} from "./fetchPage";
import { assertPublicHttpUrl, fetchPinnedPublicUrl } from "./publicUrl";
import { POST_TYPE_IDS } from "./taxonomy";
import { resolveDestination } from "./destination";
import {
  buttonsWithRegistration,
  publishedImageUrl,
  storedEventIssues,
  submissionBlocksRetry,
} from "./publishPolicy";
import { fitInlineImage } from "./mergePosters";
import { imagePublishToken } from "./imagePublishToken";
import { hasDatabaseErrorCode } from "./dbError";
import { validationOptionsForSource } from "./sourcePolicy";

type EventRow = typeof events.$inferSelect;

function affectedRows(result: unknown): number {
  return Number((result as { affectedRows?: number })?.affectedRows ?? 0);
}

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
  const buttons = buttonsWithRegistration(
    (ev.buttons ?? []) as { title: string; link: string }[],
    ev.registrationUrl,
  );
  const screensIds = (ev.screensIds ?? []) as number[];

  // Never hand a third-party image URL to CommunityHub. Its server fetches the
  // URL, so all source images cross our pinned fetch boundary first and are
  // served from this application.
  const image = ev.imageData
    ? publishedImageUrl(ev.id, ev.imageData, appUrl, imagePublishToken(ev.id, ev.imageData))
    : undefined;

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
  if (ev.locationType === "ph2" || ev.locationType === "bo") {
    payload.location = ev.location ?? "";
    // CommunityHub's Location entity requires a string place id, and its
    // PostManager passes what we send straight into the setter. Sending no such
    // field meant it received null and threw a 500 on every event that had an
    // address. The API's name for it is placeId (the old app sent placeId: ""
    // on every one of its successful posts, and their docs list it), and an
    // empty string is what a post with no Google lookup carries.
    payload.placeId = "";
  }
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
      "CommunityHub cannot publish any event that has an address right now. Its " +
      "address lookup is returning nothing and its server stops on that instead of " +
      "carrying on, so this fails no matter how the address is written. Events with " +
      "no address still publish normally. This needs fixing on the CommunityHub side; " +
      "nothing is wrong with this event."
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
type RehostedImage = { url: string; imageData: string };

async function rehostImage(
  eventId: number,
  url: string,
  appUrl: string,
): Promise<RehostedImage | null> {
  try {
    const fetched = await fetchPublicBytes(url, {
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 20_000,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    if (!fetched.ok) return null;
    const buf = Buffer.from(fetched.bytes);
    // Sanity-check it really is an image before we serve it as one.
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50;
    const isGif = buf[0] === 0x47 && buf[1] === 0x49;
    const isWebp = buf.subarray(8, 12).toString() === "WEBP";
    if (!buf.length || !(isJpeg || isPng || isGif || isWebp)) return null;
    const jpeg = await fitInlineImage(buf);
    if (!jpeg) return null;
    const imageData = jpeg.toString("base64");
    const hostedUrl = `${appUrl.replace(/\/+$/, "")}/api/events/${eventId}/image.jpg`;
    await db
      .update(events)
      .set({ imageData, imageCdnUrl: hostedUrl })
      .where(eq(events.id, eventId));
    return { url: hostedUrl, imageData };
  } catch {
    return null;
  }
}

export async function publishEvent(
  eventId: number,
  finalStatus: "approved" | "submitted" | "published" = "submitted",
): Promise<PublishResult> {
  const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!ev) return { ok: false, state: "failed", message: "Event not found." };
  const [source] = ev.sourceId
    ? await db
        .select({ slug: sources.slug, communitySlug: communities.slug })
        .from(sources)
        .leftJoin(communities, eq(communities.id, sources.communityId))
        .where(and(eq(sources.id, ev.sourceId), eq(sources.communityId, ev.communityId)))
        .limit(1)
    : [null];
  const validationIssues = storedEventIssues(
    ev,
    validationOptionsForSource(source, { slug: source?.communitySlug }, ev.eventType),
  );
  if (validationIssues.length) {
    return {
      ok: false,
      state: "failed",
      message: `This event is not ready to publish: ${validationIssues.join(", ")}.`,
    };
  }

  // Source override, then the community's configured default, then a legacy
  // active fallback. Inventory and extraction prompts use this same resolver.
  const { destination: dest, error: destinationError } = await resolveDestination(
    ev.communityId,
    ev.sourceId,
  );

  if (destinationError) {
    return { ok: false, state: "failed", message: destinationError };
  }

  // No endpoint configured: the event simply lives in this community's calendar.
  if (!dest) {
    await db.update(events).set({ status: finalStatus }).where(eq(events.id, ev.id));
    return { ok: true, state: "skipped", message: "No endpoint configured; kept in the AI calendar." };
  }
  let cfg: { submit_url?: string };
  try {
    cfg = (typeof dest.config === "string" ? JSON.parse(dest.config) : dest.config) as {
      submit_url?: string;
    };
  } catch {
    return { ok: false, state: "failed", message: "This destination has invalid configuration." };
  }
  if (!cfg?.submit_url) {
    return { ok: false, state: "failed", message: "This destination has no submit URL." };
  }
  try {
    if (process.env.NODE_ENV === "production" && new URL(cfg.submit_url).protocol !== "https:") {
      return { ok: false, state: "failed", message: "Publishing endpoints must use HTTPS." };
    }
    await assertPublicHttpUrl(cfg.submit_url);
  } catch {
    return { ok: false, state: "failed", message: "The publishing endpoint is not a public address." };
  }

  const appUrl = process.env.APP_URL || "https://ai-calendar.uhurued.com";
  let publishableEvent = ev;
  if (!ev.imageData && ev.imageCdnUrl) {
    const hosted = await rehostImage(ev.id, ev.imageCdnUrl, appUrl);
    if (!hosted) {
      return {
        ok: false,
        state: "failed",
        message:
          "The event image could not be securely downloaded and re-hosted. Replace the image before publishing.",
      };
    }
    publishableEvent = { ...ev, imageData: hosted.imageData, imageCdnUrl: hosted.url };
  }
  const payload = buildPayload(publishableEvent, process.env.PUBLISH_EMAIL || "", appUrl);
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
  if (submissionBlocksRetry(existing?.state)) {
    return {
      ok: false,
      state: "unknown",
      message: "A previous send is unresolved. Reconcile it in CommunityHub before retrying.",
    };
  }

  let submissionId: number;
  if (existing) {
    const [claimed] = await db
      .update(publishSubmissions)
      .set({ state: "sending", error: null })
      .where(
        and(
          eq(publishSubmissions.id, existing.id),
          inArray(publishSubmissions.state, ["prepared", "failed"]),
        ),
      );
    if (affectedRows(claimed) !== 1) {
      return {
        ok: false,
        state: "unknown",
        message: "Another publish attempt claimed this event. Refresh before trying again.",
      };
    }
    submissionId = existing.id;
  } else {
    try {
      const [inserted] = await db.insert(publishSubmissions).values({
        eventId: ev.id,
        destinationId: dest.id,
        payloadHash,
        state: "sending",
        payload,
      });
      submissionId = Number((inserted as { insertId?: number }).insertId);
      if (!Number.isInteger(submissionId) || submissionId < 1) {
        throw new Error("Publish claim did not return an id.");
      }
    } catch (error) {
      if (hasDatabaseErrorCode(error, "ER_DUP_ENTRY")) {
        return {
          ok: false,
          state: "unknown",
          message: "Another publish attempt claimed this event. Refresh before trying again.",
        };
      }
      throw error;
    }
  }

  let res: Response;
  let closeResponse: (() => Promise<void>) | null = null;
  try {
    const pinned = await fetchPinnedPublicUrl(cfg.submit_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
      redirect: "manual",
    });
    res = pinned.response;
    closeResponse = pinned.close;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    // Ambiguous: keep `sending` so nothing retries on its own.
    await db
      .update(publishSubmissions)
      .set({ error: { message } })
      .where(eq(publishSubmissions.id, submissionId));
    return { ok: false, state: "unknown", message: `Could not reach CommunityHub: ${message}` };
  }

  let body: string;
  try {
    body = new TextDecoder().decode(await readResponseBytesLimited(res, 256 * 1024));
  } catch {
    body = "Response body exceeded 256 KB.";
  } finally {
    if (res.body && !res.bodyUsed) await res.body.cancel().catch(() => undefined);
    await closeResponse?.();
  }
  if (!res.ok) {
    const permanent = permanentFailure(res.status);
    await db
      .update(publishSubmissions)
      .set({
        // Only a definite client rejection is safe to mark failed and retry later.
        state: permanent ? "failed" : "accepted_unreconciled",
        error: { status: res.status, body: body.slice(0, 500) },
      })
      .where(eq(publishSubmissions.id, submissionId));
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
    .where(eq(publishSubmissions.id, submissionId));
  // The status reflects the PATH, not just "reached the hub". "approved" means
  // a person here read it. "submitted" means nobody here did and it is waiting
  // on CommunityHub. "published" means nobody checked it at either end. All
  // three sit on CommunityHub; only the accountability differs.
  await db.update(events).set({ status: finalStatus }).where(eq(events.id, ev.id));

  return { ok: true, state: "succeeded", message: "Sent to CommunityHub.", remoteId };
}
