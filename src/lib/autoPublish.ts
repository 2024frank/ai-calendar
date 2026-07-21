import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { communities, events, sources } from "@/db/schema";
import { publishEvent } from "./publishEvent";

/**
 * Switching a source to unrestricted means "I trust this one, stop asking me".
 * That has to apply to the events already waiting, not only to the next run.
 * Otherwise the backlog sits in the queue forever and the switch looks broken.
 */

// Sent a few at a time. Each publish is an HTTP round trip to CommunityHub, so
// going one by one is slow, and going all at once hammers the hub. The deadline
// stops starting new work in time to return cleanly; anything left keeps its
// pending status and goes out on the next flush or the next run.
const CONCURRENCY = 4;
const TIME_BUDGET_MS = 240_000;

export type FlushResult = { published: number; failed: number; remaining: number };

/** The mode a source actually runs in, resolving inherit against its community. */
export async function effectiveMode(sourceId: number): Promise<"restricted" | "unrestricted"> {
  const [row] = await db
    .select({ mode: sources.mode, defaultMode: communities.defaultMode })
    .from(sources)
    .leftJoin(communities, eq(communities.id, sources.communityId))
    .where(eq(sources.id, sourceId))
    .limit(1);
  return row?.mode ?? row?.defaultMode ?? "restricted";
}

/**
 * Publish every pending event belonging to these sources, as an automatic send
 * (status "submitted", the same path a new event takes under unrestricted mode).
 * Anything that fails to reach the hub keeps its pending status so a person can
 * still deal with it.
 */
export async function publishPendingForSources(sourceIds: number[]): Promise<FlushResult> {
  if (!sourceIds.length) return { published: 0, failed: 0, remaining: 0 };
  const startedAt = Date.now();

  const waiting = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.status, "pending"), inArray(events.sourceId, sourceIds)));

  let published = 0;
  let failed = 0;
  let processed = 0;

  for (let i = 0; i < waiting.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    const batch = waiting.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (row) => {
        try {
          const res = await publishEvent(row.id, "submitted");
          return res.state === "succeeded";
        } catch {
          return false;
        }
      }),
    );
    processed += batch.length;
    for (const ok of results) ok ? published++ : failed++;
  }

  return { published, failed, remaining: waiting.length - processed };
}

/** Flush one source, but only if it is actually unrestricted now. */
export async function flushSourceIfUnrestricted(sourceId: number): Promise<FlushResult> {
  if ((await effectiveMode(sourceId)) !== "unrestricted") {
    return { published: 0, failed: 0, remaining: 0 };
  }
  return publishPendingForSources([sourceId]);
}

/**
 * A community switching its default to unrestricted carries every source that
 * inherits that default. Sources with their own explicit mode are left alone,
 * because someone chose that setting deliberately.
 */
export async function flushCommunityInheritors(communityId: number): Promise<FlushResult> {
  const inheriting = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.communityId, communityId), isNull(sources.mode)));
  return publishPendingForSources(inheriting.map((row) => row.id));
}
