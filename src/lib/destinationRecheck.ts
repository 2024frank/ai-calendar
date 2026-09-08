import "server-only";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/db";
import { communities, events, sources } from "@/db/schema";
import { apolloAnnouncementsMatch, isApolloSource } from "./apolloDuplicatePolicy";
import { contentMatches } from "./contract";
import { sourceEventUrlsOverlap } from "./duplicatePolicy";
import { DESTINATION_INVENTORY_HOLD, withoutDestinationHold } from "./eventHolds";
import { fetchDestinationInventory } from "./inventory";

export type RecheckResult = {
  available: boolean;
  reason?: string;
  checked: number;
  cleared: number;
  duplicates: number;
};

/**
 * Events that arrived while CommunityHub could not be read carry a hold that
 * nothing clears on its own. Now that the feed answers, compare each held
 * event against it the way ingest does: a match becomes a duplicate linked to
 * the live post, and the rest lose the hold and stand on their other issues.
 */
export async function recheckDestinationHolds(communityId: number): Promise<RecheckResult> {
  const inventory = await fetchDestinationInventory(communityId, null, 25_000);
  if (!inventory.available) {
    return { available: false, reason: inventory.reason, checked: 0, cleared: 0, duplicates: 0 };
  }
  const [community] = await db
    .select({ slug: communities.slug })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  const sourceRows = await db
    .select({ id: sources.id, slug: sources.slug, url: sources.url, calendarSourceUrl: sources.calendarSourceUrl, orgWebsite: sources.orgWebsite })
    .from(sources)
    .where(eq(sources.communityId, communityId));
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));

  const held = await db
    .select({
      id: events.id, sourceId: events.sourceId, status: events.status, eventType: events.eventType,
      title: events.title, description: events.description, sessions: events.sessions, location: events.location,
      website: events.website, calendarSourceUrl: events.calendarSourceUrl, urlLink: events.urlLink,
      registrationUrl: events.registrationUrl, rejectionReason: events.rejectionReason,
    })
    .from(events)
    .where(and(
      eq(events.communityId, communityId),
      inArray(events.status, ["pending", "auto_rejected"]),
      like(events.rejectionReason, `%${DESTINATION_INVENTORY_HOLD}%`),
    ))
    .limit(500);

  let cleared = 0;
  let duplicates = 0;
  for (const event of held) {
    const source = event.sourceId ? sourceById.get(event.sourceId) : undefined;
    const apollo = isApolloSource(source, community);
    const listingUrls = [source?.url, source?.calendarSourceUrl, source?.orgWebsite];
    const startTimes = Array.isArray(event.sessions)
      ? (event.sessions as { startTime?: unknown }[]).map((s) => Number(s.startTime)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    let matched: { reason: string; url: string | null } | null = null;
    for (const post of inventory.items) {
      if (apollo) {
        const match = apolloAnnouncementsMatch(event, post);
        if (match.match) { matched = { reason: match.reason, url: post.url }; break; }
        continue;
      }
      if (sourceEventUrlsOverlap(event, post, listingUrls)) {
        matched = { reason: "same source event URL", url: post.url };
        break;
      }
      const match = contentMatches(
        { title: event.title ?? "", startTimes, location: event.location, description: event.description },
        { title: post.title, startTimes: post.startTimes, location: post.location, description: post.description },
      );
      if (match.match) { matched = { reason: match.reason, url: post.url }; break; }
    }
    if (matched) {
      await db.update(events).set({
        status: "duplicate",
        duplicateOfUrl: matched.url,
        rejectionReason: `Already published: already on the endpoint (${matched.reason})`,
      }).where(and(eq(events.id, event.id), eq(events.status, event.status)));
      duplicates += 1;
    } else {
      await db.update(events).set({ rejectionReason: withoutDestinationHold(event.rejectionReason) })
        .where(and(eq(events.id, event.id), eq(events.status, event.status)));
      cleared += 1;
    }
  }
  return { available: true, checked: held.length, cleared, duplicates };
}
