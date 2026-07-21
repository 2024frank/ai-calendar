import { NextResponse } from "next/server";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, runs } from "@/db/schema";
import { correctNextEvent } from "@/lib/correction";
import { getSession, isAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Fix ONE auto-rejected event and return. The client calls this in a loop until
 * `done`, which keeps each request short and each prompt small.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { runId?: number; sourceId?: number };
  const sourceId = body.sourceId ? Number(body.sourceId) : null;

  // Reuse the caller's run so the whole pass shares one timeline and one cost
  // total; start one on the first call.
  let runId = Number(body.runId);
  if (!Number.isInteger(runId) || runId <= 0) {
    const [first] = await db
      .select({ sourceId: events.sourceId, communityId: events.communityId })
      .from(events)
      .where(and(eq(events.status, "auto_rejected"), isNotNull(events.sourceId)))
      .limit(1);
    if (!first?.sourceId) return NextResponse.json({ done: true, fixed: false, remaining: 0 });
    const [res] = await db.insert(runs).values({
      sourceId: first.sourceId,
      communityId: first.communityId,
      runKind: "correction",
      status: "running",
      phase: "fetching",
    });
    runId = (res as { insertId: number }).insertId;
  }

  const result = await correctNextEvent(runId, sourceId);

  // Close the run out when the queue is empty.
  if (result.done) {
    const [row] = await db
      .select({ n: sql<number>`count(*)` })
      .from(events)
      .where(sql`${events.correctedAt} is not null`);
    await db
      .update(runs)
      .set({ status: "completed", phase: "done", finishedAt: new Date(), eventsExtracted: Number(row?.n ?? 0) })
      .where(eq(runs.id, runId));
  }

  return NextResponse.json({ ...result, runId });
}
