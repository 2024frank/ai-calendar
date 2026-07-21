import { NextResponse, after } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, runs } from "@/db/schema";
import { runCorrection } from "@/lib/correction";
import { getSession, isAdmin } from "@/lib/auth";
import { scopedSourceIds } from "@/lib/data";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Correct every auto-rejected event the caller can see, across all sources. */
export async function POST() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Anchor the run to a source that actually has auto-rejects, so the run row
  // and its timeline are reachable from that source's page.
  const [first] = await db
    .select({ sourceId: events.sourceId, communityId: events.communityId })
    .from(events)
    .where(and(eq(events.status, "auto_rejected"), isNotNull(events.sourceId)))
    .limit(1);
  if (!first?.sourceId) {
    return NextResponse.json({ error: "Nothing is auto-rejected right now." }, { status: 400 });
  }

  const [res] = await db.insert(runs).values({
    sourceId: first.sourceId,
    communityId: first.communityId,
    runKind: "correction",
    status: "running",
    phase: "fetching",
  });
  const runId = (res as { insertId: number }).insertId;

  await logActivity({
    action: "source_added",
    actorUserId: s.uid,
    actorEmail: s.email,
    summary: "Started a correction pass over all auto-rejected events",
  });

  after(async () => {
    await runCorrection(runId, null).catch(() => undefined);
  });
  return NextResponse.json({ runId });
}

/** How many are waiting, so the button can show a count. */
export async function GET() {
  const s = await getSession();
  if (!s || !isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const ids = await scopedSourceIds(s);
  if (ids && ids.length === 0) return NextResponse.json({ count: 0 });
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(eq(events.status, "auto_rejected"));
  return NextResponse.json({ count: Number(row?.n ?? 0) });
}
