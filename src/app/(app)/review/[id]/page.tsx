import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { communities, events, publishSubmissions, sources } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { resolveDestination } from "@/lib/destination";
import { EventStatus } from "@/components/bits";
import { EventReview } from "./EventReview";

export const dynamic = "force-dynamic";

export default async function ReviewDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { id } = await params;
  // The filters the queue was showing when this event was opened. Everything
  // that leaves this page goes back to that exact view.
  const { back } = await searchParams;
  const backHref = back ? `/review?${back}` : "/review";
  const s = await requireUser();
  const ev = await getEventScoped(s, Number(id));
  if (!ev) notFound();

  const [source] = ev.sourceId
    ? await db.select().from(sources).where(eq(sources.id, ev.sourceId)).limit(1)
    : [null];
  const [community] = await db
    .select()
    .from(communities)
    .where(eq(communities.id, ev.communityId))
    .limit(1);
  const [unresolvedPublish] = await db
    .select({ state: publishSubmissions.state, operation: publishSubmissions.operation })
    .from(publishSubmissions)
    .where(
      and(
        eq(publishSubmissions.eventId, ev.id),
        inArray(publishSubmissions.state, ["sending", "accepted_unreconciled"]),
      ),
    )
    .orderBy(desc(publishSubmissions.updatedAt), desc(publishSubmissions.id))
    .limit(1);
  const sentPublications = await db.select({
    destinationId: publishSubmissions.destinationId,
    externalPostId: publishSubmissions.externalPostId,
    destinationSubmitUrl: publishSubmissions.destinationSubmitUrl,
  }).from(publishSubmissions).where(and(eq(publishSubmissions.eventId, ev.id), eq(publishSubmissions.state, "succeeded")))
    .orderBy(desc(publishSubmissions.id));
  const hasPublishedPost = sentPublications.length > 0 || ["submitted", "published"].includes(ev.status);
  let updateUnavailableReason: string | null = null;
  let canUpdatePublished = false;
  if (hasPublishedPost) {
    const { destination, error } = await resolveDestination(ev.communityId, ev.sourceId);
    const linked = sentPublications.find(attempt => attempt.destinationId === destination?.id);
    if (error || !destination) updateUnavailableReason = error || "No destination is configured. This sent record cannot create another post.";
    else if (!linked) updateUnavailableReason = "No post is linked at the current destination. The destination may have changed; verify the original post before continuing.";
    else if (!linked.externalPostId || !/^[1-9]\d*$/.test(linked.externalPostId)) updateUnavailableReason = "This sent record has no verified numeric remote post ID. Reconcile its link before updating; no new post will be created.";
    else if (!linked.destinationSubmitUrl) updateUnavailableReason = "This historical post has no recorded endpoint provenance. Verify its original destination before updating; no new post will be created.";
    else {
      try {
        const config = typeof destination.config === "string" ? JSON.parse(destination.config) : destination.config;
        const url = new URL((config as { submit_url: string }).submit_url);
        if (url.pathname !== "/api/legacy/calendar/post/submit" || url.search || url.hash || url.username || url.password || !["http:", "https:"].includes(url.protocol) || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) {
          updateUnavailableReason = "The configured destination does not support the expected CommunityHub update endpoint.";
        } else if (url.toString() !== linked.destinationSubmitUrl) {
          updateUnavailableReason = "The endpoint changed after this post was sent. Verify its original destination before updating; no new post will be created.";
        } else canUpdatePublished = true;
      } catch { updateUnavailableReason = "The destination configuration is invalid; verify it before updating."; }
    }
  }

  // For a duplicate, load the event it duplicates so the reviewer can compare.
  const [original] = ev.duplicateOfEventId
    ? await db
        .select({ id: events.id, title: events.title, status: events.status })
        .from(events)
        .where(eq(events.id, ev.duplicateOfEventId))
        .limit(1)
    : [null];

  return (
    <div className="grid" style={{ gap: 18, maxWidth: 1200 }}>
      <div>
        <Link href={backHref} className="muted" style={{ fontSize: 13 }}>
          ← Back to the queue
        </Link>
        <div className="spread" style={{ marginTop: 4 }}>
          <div className="page-title">{ev.title || "(untitled)"}</div>
          <EventStatus status={ev.status} />
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          Save edits, then approve an unsent event or explicitly update its existing post. Request a correction for fixable details; reject permanently only when it should be excluded.
        </div>
      </div>

      <EventReview
        backQuery={back ?? null}
        event={{
          id: ev.id,
          status: ev.status,
          eventType: ev.eventType,
          title: ev.title,
          description: ev.description,
          extendedDescription: ev.extendedDescription,
          sessions: (ev.sessions ?? []) as { startTime: number; endTime: number }[],
          locationType: ev.locationType,
          location: ev.location,
          placeName: ev.placeName,
          roomNum: ev.roomNum,
          geoScope: ev.geoScope,
          urlLink: ev.urlLink,
          displayType: ev.displayType,
          screensIds: (ev.screensIds ?? []) as number[],
          postTypeIds: (ev.postTypeIds ?? []) as number[],
          sponsors: (ev.sponsors ?? []) as string[],
          buttons: (ev.buttons ?? []) as { title: string; link: string }[],
          website: ev.website,
          registrationUrl: ev.registrationUrl,
          imageCdnUrl: ev.imageCdnUrl,
          hasImageData: !!ev.imageData,
          contactEmail: ev.contactEmail,
          phone: ev.phone,
          calendarSourceName: ev.calendarSourceName,
          calendarSourceUrl: ev.calendarSourceUrl,
          ingestedPostUrl: ev.ingestedPostUrl,
          fieldNotes: (ev.fieldNotes ?? null) as Record<string, string> | null,
          rejectionReason: ev.rejectionReason,
          duplicateOfEventId: ev.duplicateOfEventId,
          duplicateOfUrl: ev.duplicateOfUrl,
          duplicateOfTitle: original?.title ?? null,
          proposedUpdateOfEventId: ev.proposedUpdateOfEventId,
          correctionRequest: ev.correctionRequest,
          correctionState: ev.correctionState,
          correctionError: ev.correctionError,
          proposalResolvedAt: ev.proposalResolvedAt?.toISOString() ?? null,
        }}
        sourceName={source?.name ?? "Unknown source"}
        publishEmail={process.env.PUBLISH_EMAIL ?? ""}
        timezone={community?.timezone ?? "America/New_York"}
        unresolvedPublish={Boolean(unresolvedPublish)}
        unresolvedOperation={unresolvedPublish?.operation ?? "create"}
        hasPublishedPost={hasPublishedPost}
        canUpdatePublished={canUpdatePublished}
        updateUnavailableReason={updateUnavailableReason}
      />
    </div>
  );
}
