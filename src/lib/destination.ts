import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, destinations, sources } from "@/db/schema";

export async function resolveDestination(communityId: number, sourceId?: number | null) {
  const [community] = await db
    .select({ defaultDestinationId: communities.defaultDestinationId, status: communities.status })
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  if (!community || community.status !== "active") {
    return { destination: null, error: "This community is not active." };
  }

  const [source] = sourceId
    ? await db
        .select({ destinationId: sources.destinationId })
        .from(sources)
        .where(and(eq(sources.id, sourceId), eq(sources.communityId, communityId)))
        .limit(1)
    : [undefined];
  const preferredId = source?.destinationId ?? community.defaultDestinationId;

  if (preferredId) {
    const [destination] = await db
      .select()
      .from(destinations)
      .where(eq(destinations.id, preferredId))
      .limit(1);
    if (!destination || destination.communityId !== communityId || !destination.active) {
      return { destination: null, error: "The configured destination is unavailable." };
    }
    return { destination, error: null };
  }

  const [fallback] = await db
    .select()
    .from(destinations)
    .where(and(eq(destinations.communityId, communityId), eq(destinations.active, true)))
    .limit(1);
  return { destination: fallback ?? null, error: null };
}
