import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { communities, events, sources } from "@/db/schema";
import { validateEvent, type ExtractedEvent } from "./contract";
import { validationOptionsForSource } from "./sourcePolicy";

/**
 * Recompute a pending event's "needs fields" flag from what is SAVED now.
 * The flag is written once at ingest; without this it survives every reviewer
 * edit, so a completed event keeps wearing a stale "needs fields" tag.
 */
export async function refreshPendingFlag(eventId: number) {
  const [ev] = await db
    .select({
      id: events.id,
      eventType: events.eventType,
      status: events.status,
      title: events.title,
      description: events.description,
      extendedDescription: events.extendedDescription,
      sponsors: events.sponsors,
      imageCdnUrl: events.imageCdnUrl,
      hasImage: sql<number>`(${events.imageData} is not null)`,
      website: events.website,
      contactEmail: events.contactEmail,
      phone: events.phone,
      postTypeIds: events.postTypeIds,
      sessions: events.sessions,
      locationType: events.locationType,
      location: events.location,
      urlLink: events.urlLink,
      registrationUrl: events.registrationUrl,
      rejectionReason: events.rejectionReason,
      sourceSlug: sources.slug,
      communitySlug: communities.slug,
    })
    .from(events)
    .leftJoin(sources, eq(sources.id, events.sourceId))
    .leftJoin(communities, eq(communities.id, events.communityId))
    .where(eq(events.id, eventId))
    .limit(1);
  if (!ev || ev.status !== "pending") return;

  const adapted = {
    eventType: ev.eventType ?? "ot",
    title: ev.title ?? "",
    description: ev.description ?? "",
    extendedDescription: ev.extendedDescription ?? null,
    sponsors: (ev.sponsors ?? []) as string[],
    imageCdnUrl: ev.imageCdnUrl,
    imageData: ev.hasImage ? "present" : null,
    website: ev.website,
    contactEmail: ev.contactEmail,
    phone: ev.phone,
    postTypeId: (ev.postTypeIds ?? []) as number[],
    sessions: (ev.sessions ?? []) as { startTime: number; endTime: number }[],
    locationType: ev.locationType,
    location: ev.location,
    urlLink: ev.urlLink,
    registrationUrl: ev.registrationUrl,
  } as unknown as ExtractedEvent;

  const issues = validateEvent(
    adapted,
    validationOptionsForSource(
      { slug: ev.sourceSlug },
      { slug: ev.communitySlug },
      ev.eventType,
    ),
  );
  const reason = issues.length ? `Missing before publish: ${issues.join(", ")}` : null;
  if (reason !== ev.rejectionReason) {
    await db.update(events).set({ rejectionReason: reason }).where(eq(events.id, eventId));
  }
}
