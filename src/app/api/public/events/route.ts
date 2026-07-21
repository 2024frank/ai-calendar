import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { communities, events, sources } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only feed of the events this system holds.
 *
 * GET only, and it never exposes anything but event content: no run internals,
 * no source credentials, no reviewer identities. Reading is all it can do.
 *
 * Query parameters
 *   status     pending | approved | submitted | duplicate | rejected | auto_rejected | all
 *              (default: everything a human has accepted, i.e. approved + submitted)
 *   community  community id or slug
 *   source     source id
 *   from       only events with a session starting at/after this ISO date
 *   upcoming   "true" to hide events whose last session has passed
 *   q          text match on title or location
 *   limit      1-500 (default 100)
 *   offset     for paging
 */
const STATUSES = [
  "pending",
  "approved",
  "submitted",
  "duplicate",
  "rejected",
  "auto_rejected",
] as const;
type Status = (typeof STATUSES)[number];

function sessionsOf(row: { sessions: unknown }) {
  return Array.isArray(row.sessions)
    ? (row.sessions as { startTime: number; endTime: number }[])
    : [];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams;

  const limit = Math.min(Math.max(Number(p.get("limit") ?? 100), 1), 500);
  const offset = Math.max(Number(p.get("offset") ?? 0), 0);

  const statusParam = (p.get("status") ?? "").trim();
  let statuses: Status[];
  if (statusParam === "all") {
    statuses = [...STATUSES];
  } else if (statusParam) {
    statuses = statusParam
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is Status => (STATUSES as readonly string[]).includes(s));
    if (!statuses.length) {
      return NextResponse.json(
        { error: `status must be one of: ${STATUSES.join(", ")}, or all` },
        { status: 400 },
      );
    }
  } else {
    // Default to what a person has actually accepted.
    statuses = ["approved", "submitted"];
  }

  const conds = [inArray(events.status, statuses)];

  const communityParam = (p.get("community") ?? "").trim();
  if (communityParam) {
    const [row] = await db
      .select({ id: communities.id })
      .from(communities)
      .where(
        /^\d+$/.test(communityParam)
          ? eq(communities.id, Number(communityParam))
          : eq(communities.slug, communityParam),
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
    const like = `%${q}%`;
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
        // Shared caches absorb public-feed traffic. A stale response is safe
        // while one edge request refreshes it in the background.
        "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
        "access-control-allow-origin": "*",
      },
    },
  );
}
