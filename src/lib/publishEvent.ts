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
export async function publishEvent(eventId: number): Promise<PublishResult> {
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
    return {
      ok: false,
      state: permanent ? "failed" : "unknown",
      message: `CommunityHub rejected this (${res.status}). ${body.slice(0, 200)}`,
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
  await db.update(events).set({ status: "submitted" }).where(eq(events.id, ev.id));

  return { ok: true, state: "succeeded", message: "Sent to CommunityHub.", remoteId };
}
