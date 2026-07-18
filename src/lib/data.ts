import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  communities,
  destinations,
  events,
  reviewerSources,
  runs,
  sources,
} from "@/db/schema";
import type { Session } from "./auth";

/** Source ids this session may see. null => all (platform_admin). */
export async function scopedSourceIds(s: Session): Promise<number[] | null> {
  if (s.role === "platform_admin") return null;
  if (s.role === "community_admin" || s.canReviewAllSources) {
    const rows = await db
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.communityId, s.communityId ?? -1));
    return rows.map((r) => r.id);
  }
  const rows = await db
    .select({ id: reviewerSources.sourceId })
    .from(reviewerSources)
    .where(eq(reviewerSources.userId, s.uid));
  return rows.map((r) => r.id);
}

export async function listCommunities() {
  return db.select().from(communities).orderBy(communities.id);
}

export async function listDestinations(communityId?: number) {
  const q = db.select().from(destinations);
  return communityId ? q.where(eq(destinations.communityId, communityId)) : q;
}

export async function listSources(s: Session) {
  const ids = await scopedSourceIds(s);
  if (ids && ids.length === 0) return [];
  const rows = ids
    ? await db.select().from(sources).where(inArray(sources.id, ids)).orderBy(sources.name)
    : await db.select().from(sources).orderBy(sources.name);
  return rows;
}

export async function getSource(s: Session, id: number) {
  const ids = await scopedSourceIds(s);
  if (ids && !ids.includes(id)) return null;
  const [row] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  return row ?? null;
}

function n(v: unknown) {
  return Number(v ?? 0);
}

export async function dashboardStats(s: Session) {
  const ids = await scopedSourceIds(s);
  const empty = ids && ids.length === 0;

  const srcWhere = ids ? inArray(sources.id, ids) : undefined;
  const [srcRow] = empty
    ? [{ n: 0, active: 0 }]
    : await db
        .select({
          n: sql<number>`count(*)`,
          active: sql<number>`sum(case when ${sources.active} = 1 then 1 else 0 end)`,
        })
        .from(sources)
        .where(srcWhere);

  const evWhere = ids ? inArray(events.sourceId, ids) : undefined;
  const [evRow] = empty
    ? [{ pending: 0, approved: 0, submitted: 0, duplicate: 0 }]
    : await db
        .select({
          pending: sql<number>`sum(case when ${events.status} = 'pending' then 1 else 0 end)`,
          approved: sql<number>`sum(case when ${events.status} = 'approved' then 1 else 0 end)`,
          submitted: sql<number>`sum(case when ${events.status} = 'submitted' then 1 else 0 end)`,
          duplicate: sql<number>`sum(case when ${events.status} = 'duplicate' then 1 else 0 end)`,
        })
        .from(events)
        .where(evWhere);

  const recentRuns = empty
    ? []
    : await db
        .select()
        .from(runs)
        .where(ids ? inArray(runs.sourceId, ids) : undefined)
        .orderBy(desc(runs.startedAt))
        .limit(8);

  return {
    sources: n(srcRow?.n),
    activeSources: n(srcRow?.active),
    pending: n(evRow?.pending),
    approved: n(evRow?.approved),
    submitted: n(evRow?.submitted),
    duplicate: n(evRow?.duplicate),
    recentRuns,
  };
}

export async function reviewQueue(s: Session, limit = 100) {
  const ids = await scopedSourceIds(s);
  if (ids && ids.length === 0) return [];
  const where = ids
    ? and(eq(events.status, "pending"), inArray(events.sourceId, ids))
    : eq(events.status, "pending");
  return db.select().from(events).where(where).orderBy(desc(events.createdAt)).limit(limit);
}
