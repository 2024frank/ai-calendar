import { NextResponse } from "next/server";
import { and, desc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { communities, events, runs, sources } from "@/db/schema";
import { verifyRunToken } from "@/lib/agentToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only feed of the events this system holds.
 *
 * GET only, and it exposes accepted/published event content: no review queue,
 * rejected records, run internals, source credentials, or reviewer identities.
 *
 * Query parameters
 *   status     approved | submitted | published | all
 *              (default: every accepted or published event)
 *              "pending" is available ONLY to the extraction agent, which
 *              proves itself with runId + token. The review queue is not public.
 *   community  community id or slug
 *   source     source id
 *   from       only events with a session starting at/after this ISO date
 *   upcoming   "true" to hide events whose last session has passed
 *   q          text match on title or location
 *   limit      1-500 (default 100)
 *   offset     for paging
 */
const STATUSES = ["approved", "submitted", "published"] as const;
type Status = (typeof STATUSES)[number] | "pending";

/**
 * The agent is the duplicate judge, so it has to see everything this calendar
 * already holds, including the events still waiting for a reviewer. Those are
 * unreviewed and must never reach the public feed, so "pending" is unlocked
 * only for a caller holding the HMAC token for a live run.
 *
 * Without this the agent compared against approved events alone and was blind
 * to the whole review queue. Anything duplicated into pending stayed invisible,
 * so the next run brought another copy that also landed in pending. That is how
 * one opera arrived twice and one monthly open house arrived as three events.
 */
async function agentPendingCommunity(p: URLSearchParams): Promise<number | null> {
  const runId = Number(p.get("runId"));
  const token = (p.get("token") ?? "").trim();
  if (!Number.isSafeInteger(runId) || runId <= 0 || !token) return null;
  try {
    if (!verifyRunToken(runId, token)) return null;
  } catch {
    return null;
  }
  // A signature proves possession, not current permission. Bind access to the
  // actual live extraction and its tenant; old tokens must not expose a queue.
  const [run] = await db
    .select({ communityId: runs.communityId })
    .from(runs)
    .innerJoin(sources, eq(sources.id, runs.sourceId))
    .innerJoin(communities, eq(communities.id, runs.communityId))
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.runKind, "extraction"),
        eq(runs.status, "running"),
        isNull(runs.finishedAt),
        or(isNull(runs.deadlineAt), gt(runs.deadlineAt, new Date())),
        eq(sources.communityId, runs.communityId),
        eq(communities.status, "active"),
      ),
    )
    .limit(1);
  return run?.communityId ?? null;
}

function boundedInt(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function sessionsOf(row: { sessions: unknown }) {
  return Array.isArray(row.sessions)
    ? (row.sessions as { startTime: number; endTime: number }[])
    : [];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams;

  const limit = boundedInt(p.get("limit"), 100, 1, 500);
  const offset = boundedInt(p.get("offset"), 0, 0, 10_000);

  const statusParam = (p.get("status") ?? "").trim();
  const pendingCommunityId = await agentPendingCommunity(p);
  const allowed: readonly string[] = pendingCommunityId !== null
    ? [...STATUSES, "pending"]
    : STATUSES;
  let statuses: Status[];
  if (statusParam === "all") {
    statuses = [...allowed] as Status[];
  } else if (statusParam) {
    statuses = statusParam
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is Status => allowed.includes(s));
    if (!statuses.length) {
      return NextResponse.json(
        { error: `status must be one of: ${STATUSES.join(", ")}, or all` },
        { status: 400 },
      );
    }
  } else {
    statuses = [...STATUSES] as Status[];
  }

  const activeCommunityIds = db
    .select({ id: communities.id })
    .from(communities)
    .where(eq(communities.status, "active"));
  const conds = [inArray(events.status, statuses), inArray(events.communityId, activeCommunityIds)];
  if (pendingCommunityId !== null) conds.push(eq(events.communityId, pendingCommunityId));

  const communityParam = (p.get("community") ?? "").trim();
  if (communityParam) {
    const [row] = await db
      .select({ id: communities.id })
      .from(communities)
      .where(
        /^\d+$/.test(communityParam)
          ? and(eq(communities.id, Number(communityParam)), eq(communities.status, "active"))
          : and(eq(communities.slug, communityParam), eq(communities.status, "active")),
      )
      .limit(1);
    if (!row) return NextResponse.json({ error: "Unknown community." }, { status: 404 });
    conds.push(eq(events.communityId, row.id));
  }

  const sourceParam = Number(p.get("source"));
  if (Number.isInteger(sourceParam) && sourceParam > 0) {
    conds.push(eq(events.sourceId, sourceParam));
  }

  const q = (p.get("q") ?? "").trim();
  if (q) {
    const like = `%${q.slice(0, 200)}%`;
    conds.push(sql`(${events.title} like ${like} or ${events.location} like ${like})`);
  }

  const from = (p.get("from") ?? "").trim();
  if (from) {
    const at = Date.parse(from);
    if (Number.isNaN(at)) {
      return NextResponse.json({ error: "from must be a date." }, { status: 400 });
    }
    conds.push(gte(events.startTimeMax, Math.floor(at / 1000)));
  }

  if (p.get("upcoming") === "true") {
    conds.push(gte(events.startTimeMax, Math.floor(Date.now() / 1000)));
  }

  const rows = await db
    .select({
      id: events.id,
      status: events.status,
      eventType: events.eventType,
      title: events.title,
      description: events.description,
      extendedDescription: events.extendedDescription,
      sessions: events.sessions,
      locationType: events.locationType,
      location: events.location,
      placeName: events.placeName,
      roomNum: events.roomNum,
      urlLink: events.urlLink,
      postTypeIds: events.postTypeIds,
      sponsors: events.sponsors,
      website: events.website,
      registrationUrl: events.registrationUrl,
      imageCdnUrl: events.imageCdnUrl,
      contactEmail: events.contactEmail,
      phone: events.phone,
      calendarSourceName: events.calendarSourceName,
      calendarSourceUrl: events.calendarSourceUrl,
      createdAt: events.createdAt,
      sourceName: sources.name,
      communitySlug: communities.slug,
    })
    .from(events)
    .leftJoin(sources, eq(sources.id, events.sourceId))
    .leftJoin(communities, eq(communities.id, events.communityId))
    .where(and(...conds))
    .orderBy(desc(events.startTimeMax))
    .limit(limit)
    .offset(offset);

  const [countRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(and(...conds));

  return NextResponse.json(
    {
      total: Number(countRow?.n ?? 0),
      limit,
      offset,
      events: rows.map((r) => ({
        ...r,
        sessions: sessionsOf(r),
        // Times are stored as unix seconds; give ISO too so a consumer does not
        // have to guess the timezone.
        sessionsIso: sessionsOf(r).map((s) => ({
          start: new Date(s.startTime * 1000).toISOString(),
          end: new Date(s.endTime * 1000).toISOString(),
        })),
      })),
    },
    {
      headers: {
        // Cache accepted public content only. A private queue response must
        // never outlive the run's permission in a browser or shared cache.
        "cache-control": pendingCommunityId !== null
          ? "private, no-store"
          : "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
        "access-control-allow-origin": "*",
      },
    },
  );
}
