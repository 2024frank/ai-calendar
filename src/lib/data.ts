import "server-only";
import { cookies } from "next/headers";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  communities,
  destinations,
  events,
  runs,
  sources,
  userCommunities,
} from "@/db/schema";
import type { Session } from "./auth";

/**
 * Communities this user may work in: their home community plus any extra
 * membership. A platform admin may work in every community.
 */
export async function accessibleCommunities(s: Session) {
  if (s.role === "platform_admin") return listCommunities();
  const extra = await db
    .select({ id: userCommunities.communityId })
    .from(userCommunities)
    .where(eq(userCommunities.userId, s.uid));
  const ids = [...new Set([s.communityId, ...extra.map((r) => r.id)].filter(Boolean))] as number[];
  if (!ids.length) return [];
  return db.select().from(communities).where(inArray(communities.id, ids)).orderBy(communities.name);
}

/** The community the user is currently working in, honouring their choice. */
export async function activeCommunityId(s: Session, chosen?: number | null) {
  const allowed = await accessibleCommunities(s);
  if (chosen && allowed.some((c) => c.id === chosen)) return chosen;
  return s.communityId ?? allowed[0]?.id ?? null;
}

/** The community currently selected in the sidebar, validated against access. */
export async function currentCommunityId(s: Session): Promise<number | null> {
  const raw = (await cookies()).get("ac_community")?.value;
  const id = Number(raw);
  if (!Number.isInteger(id)) return s.communityId ?? null;
  const allowed = await accessibleCommunities(s);
  return allowed.some((c) => c.id === id) ? id : (s.communityId ?? null);
}

/** Source ids this session may see. null => every community (platform admin). */
export async function scopedSourceIds(s: Session): Promise<number[] | null> {
  const active = await currentCommunityId(s);
  if (s.role === "platform_admin") {
    // Scoped once a community is picked; otherwise everything.
    if (!active) return null;
    const rows = await db
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.communityId, active));
    return rows.map((r) => r.id);
  }
  // Community admins and reviewers alike see every source in their active
  // community. Access is granted by community membership: if you belong to a
  // community, you review everything in it. Reviewers are scoped to a community,
  // not to individual sources.
  const rows = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.communityId, active ?? s.communityId ?? -1));
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

/** Load one event only if this session is allowed to see it. */
export async function getEventScoped(s: Session, id: number) {
  const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  if (!row) return null;
  const active = await currentCommunityId(s);
  if (active && row.communityId !== active) return null;
  const ids = await scopedSourceIds(s);
  if (ids && row.sourceId && !ids.includes(row.sourceId)) return null;
  return row;
}

type EventStatus = "pending" | "approved" | "submitted" | "duplicate" | "rejected" | "auto_rejected";
type EventFilter = { sourceId?: number; eventType?: string; q?: string };

async function eventsByStatus(
  s: Session,
  statuses: EventStatus[],
  filter: EventFilter = {},
  limit = 200,
) {
  const ids = await scopedSourceIds(s);
  if (ids && ids.length === 0) return [];
  const conds = [inArray(events.status, statuses)];
  if (ids) conds.push(inArray(events.sourceId, ids));
  // Explicit tenant wall so a scoping bug elsewhere can't leak across communities.
  const active = await currentCommunityId(s);
  if (active) conds.push(eq(events.communityId, active));
  if (filter.sourceId) conds.push(eq(events.sourceId, filter.sourceId));
  if (filter.eventType) conds.push(eq(events.eventType, filter.eventType));
  const term = filter.q?.trim();
  if (term) {
    const like = `%${term}%`;
    // Match what someone would actually type. Title and location alone missed
    // the obvious ones: searching an organization's name, or a word that only
    // appears in the event's own description, found nothing at all.
    const named = await db
      .select({ id: sources.id })
      .from(sources)
      .where(sql`${sources.name} like ${like} or ${sources.orgName} like ${like}`);
    const bySource = named.length
      ? sql` or ${events.sourceId} in (${sql.join(
          named.map((row) => sql`${row.id}`),
          sql`, `,
        )})`
      : sql``;
    conds.push(
      sql`(${events.title} like ${like} or ${events.location} like ${like} or ${events.description} like ${like}${bySource})`,
    );
  }
  return db.select().from(events).where(and(...conds)).orderBy(desc(events.createdAt)).limit(limit);
}

export async function reviewQueue(s: Session, filter: EventFilter = {}, limit = 200) {
  return eventsByStatus(s, ["pending"], filter, limit);
}

/** How many events are waiting for review, for the nav badge. */
export async function pendingCount(s: Session): Promise<number> {
  const ids = await scopedSourceIds(s);
  if (ids && ids.length === 0) return 0;
  const conds = [eq(events.status, "pending")];
  if (ids) conds.push(inArray(events.sourceId, ids));
  const active = await currentCommunityId(s);
  if (active) conds.push(eq(events.communityId, active));
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(and(...conds));
  return Number(row?.n ?? 0);
}

/** Events kept as duplicates — viewable, not discarded. */
export async function duplicatesQueue(s: Session, filter: EventFilter = {}, limit = 200) {
  return eventsByStatus(s, ["duplicate"], filter, limit);
}

/** Any status tab (approved, submitted, rejected+auto_rejected). */
export async function eventsForTab(s: Session, statuses: EventStatus[], filter: EventFilter = {}) {
  return eventsByStatus(s, statuses, filter);
}
