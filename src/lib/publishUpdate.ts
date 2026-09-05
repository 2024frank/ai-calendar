import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, publishSubmissions } from "@/db/schema";
import { acknowledgedCommunityHubPostId, buildPayload, type PublishResult } from "./publishEvent";
import { claimPublication } from "./publishClaim";
import { resolveDestination } from "./destination";
import { assertPublicHttpUrl, fetchPinnedPublicUrl } from "./publicUrl";
import { readResponseBytesLimited } from "./fetchPage";
import { storedEventIssues } from "./publishPolicy";
import { HARD_ISSUES } from "./contract";
import { inlineRemoteImage, INLINE_IMAGE_FAILURE_TEXT } from "./inlineImage";

/** Explicit reviewer action only. This function never falls back to a create. */
export async function publishUpdate(eventId: number): Promise<PublishResult> {
  const fail = (message: string, state: PublishResult["state"] = "failed"): PublishResult => ({ ok: false, state, message });
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return fail("Event not found.");
  const blocking = storedEventIssues(event).filter(issue => HARD_ISSUES.has(issue) || issue.endsWith("_invalid"));
  if (blocking.length) return fail(`This event is not ready to update: ${blocking.join(", ")}.`);
  const { destination, error } = await resolveDestination(event.communityId, event.sourceId);
  if (error || !destination) return fail(error || "No destination is configured; there is no remote post to update.");
  let submitUrl: URL;
  try {
    const config = typeof destination.config === "string" ? JSON.parse(destination.config) : destination.config;
    submitUrl = new URL((config as { submit_url: string }).submit_url);
    if (submitUrl.pathname !== "/api/legacy/calendar/post/submit" || submitUrl.search || submitUrl.hash || submitUrl.username || submitUrl.password) {
      return fail("This destination does not use the supported CommunityHub edit contract.");
    }
    if (process.env.NODE_ENV === "production" && submitUrl.protocol !== "https:") return fail("Publishing endpoints must use HTTPS.");
    await assertPublicHttpUrl(submitUrl.toString());
  } catch { return fail("This destination has no valid public CommunityHub submit URL."); }

  const appUrl = (process.env.APP_URL || "https://ai-calendar.uhurued.com").replace(/\/+$/,"");
  const hostedImageUrl = `${appUrl}/api/events/${eventId}/image.jpg`;
  let publishableEvent = event;
  // A saved replacement URL can coexist with the old image bytes. Download
  // the replacement through our pinned image boundary, not CommunityHub's.
  if (event.imageCdnUrl && event.imageCdnUrl !== hostedImageUrl) {
    const image = await inlineRemoteImage(event.imageCdnUrl);
    if ("failure" in image) return fail(`Could not use the replacement image. ${INLINE_IMAGE_FAILURE_TEXT[image.failure]}`);
    const [saved] = await db.update(events).set({imageData:image.imageData,imageCdnUrl:hostedImageUrl})
      .where(and(eq(events.id,eventId),eq(events.imageCdnUrl,event.imageCdnUrl)));
    if (Number((saved as {affectedRows?:number}).affectedRows) !== 1) return fail("The selected image changed while downloading. Reload before updating.","skipped");
    publishableEvent = {...event,imageData:image.imageData,imageCdnUrl:hostedImageUrl};
  }
  const payload = buildPayload(publishableEvent, "", appUrl);
  delete payload.email;
  delete payload.subscribe;
  delete payload.public;
  // PATCH omissions mean "leave alone", not "clear". Express local removals
  // deliberately so a removed button/optional field does not remain remote.
  for (const key of ["extendedDescription", "placeName", "roomNum", "website", "contactEmail", "phone", "calendarSourceName", "calendarSourceUrl", "location", "urlLink"]) {
    payload[key] ??= "";
  }
  payload.buttons ??= [];
  payload.screensIds ??= [];
  const claim = await claimPublication({ eventId, destinationId: destination.id, payload, payloadHash: "", operation: "update", destinationSubmitUrl: submitUrl.toString() });
  if (claim.kind === "unresolved") return fail("A send or correction is unresolved. Reconcile the previous request before retrying.", "unknown");
  if (claim.kind === "not_linked" || claim.kind === "missing" || claim.kind === "already_sent") return fail("No known numeric remote post ID is linked at this destination. An update cannot create a post.", "skipped");
  if (claim.kind === "unchanged") return { ok: true, state: "skipped", message: "No content changes to send.", remoteId: claim.remoteId };
  if (!claim.remoteId || !claim.patch) return fail("No linked update was claimed.");
  submitUrl.pathname = `/api/legacy/calendar/post/${claim.remoteId}/submit`;
  let response: Response;
  let close: (() => Promise<void>) | undefined;
  try {
    const pinned = await fetchPinnedPublicUrl(submitUrl.toString(), {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(claim.patch),
      signal: AbortSignal.timeout(30_000), redirect: "manual",
    });
    response = pinned.response;
    close = pinned.close;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    await db.update(publishSubmissions).set({ error: { message } }).where(eq(publishSubmissions.id, claim.submissionId));
    return fail("The update outcome is unknown. Verify the post's content in CommunityHub before retrying.", "unknown");
  }
  let body = "";
  try { body = new TextDecoder().decode(await readResponseBytesLimited(response, 256 * 1024)); }
  catch { body = "Response could not be read."; }
  finally {
    if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => undefined);
    await close?.();
  }
  if (!response.ok) {
    const definite = [400,401,403,413,422].includes(response.status);
    await db.update(publishSubmissions).set({
      state: definite ? "failed" : "accepted_unreconciled", error: { status: response.status, body: body.slice(0,500) },
    }).where(eq(publishSubmissions.id, claim.submissionId));
    return fail(definite ? `CommunityHub rejected the update (${response.status}); correct it before retrying.` : "The update outcome is unknown. Verify the post's content in CommunityHub before retrying.", definite ? "failed" : "unknown");
  }
  if (!acknowledgedCommunityHubPostId(body, claim.remoteId)) {
    await db.update(publishSubmissions).set({
      state: "accepted_unreconciled",
      error: { status: response.status, message: "No trustworthy matching post acknowledgment.", body: body.slice(0, 500) },
    }).where(eq(publishSubmissions.id, claim.submissionId));
    return fail("CommunityHub did not return a trustworthy acknowledgment of this post's update. Verify the content before retrying.", "unknown");
  }
  await db.update(publishSubmissions).set({ state: "succeeded", error: null }).where(eq(publishSubmissions.id, claim.submissionId));
  return { ok: true, state: "succeeded", remoteId: claim.remoteId, message: "Content updated in CommunityHub. Moderation and subscription settings were not changed." };
}
