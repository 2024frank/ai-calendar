import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, runs } from "@/db/schema";
import { correctNextEvent } from "@/lib/correction";
import { getSession, isAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One correction takes a median of 96 seconds and regularly runs past two
// minutes, so a 120s cap killed the slow ones mid-flight and the whole pass
// reported an error. 300 is the platform ceiling and matches the other
// correction routes.
export const maxDuration = 300;

/**
 * Current state of correction work, so the page can show real progress on load
 * and resume a pass that was interrupted by closing the tab.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const raw = new URL(req.url).searchParams.get("sourceId");
  const sourceId = raw && Number.isInteger(Number(raw)) ? Number(raw) : null;
  const untried = sql`(${events.rejectionReason} is null or ${events.rejectionReason} not like '%[tried]%')`;

  const [remainingRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(
      sourceId
        ? and(eq(events.sourceId, sourceId), eq(events.status, "auto_rejected"), untried)
        : and(eq(events.status, "auto_rejected"), untried),
    );
  const [correctedRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(
      sourceId
        ? and(eq(events.sourceId, sourceId), isNotNull(events.correctedAt))
        : isNotNull(events.correctedAt),
    );
  // An unfinished correction run means a pass was interrupted; the client can
  // adopt its id and carry on rather than starting a fresh one.
  const [openRun] = await db
    .select({
      id: runs.id,
      checked: runs.eventsFound,
      corrected: runs.eventsExtracted,
      costMicros: runs.costMicros,
      promptTokens: runs.promptTokens,
      completionTokens: runs.completionTokens,
    })
    .from(runs)
    .where(
      sourceId
        ? and(eq(runs.runKind, "correction"), eq(runs.status, "running"), eq(runs.sourceId, sourceId))
        : and(eq(runs.runKind, "correction"), eq(runs.status, "running")),
    )
    .orderBy(desc(runs.id))
    .limit(1);

  return NextResponse.json({
    remaining: Number(remainingRow?.n ?? 0),
    correctedTotal: Number(correctedRow?.n ?? 0),
    openRunId: openRun?.id ?? null,
    checked: Number(openRun?.checked ?? 0),
    corrected: Number(openRun?.corrected ?? 0),
    costUsd: Number(openRun?.costMicros ?? 0) / 1_000_000,
    tokens: Number(openRun?.promptTokens ?? 0) + Number(openRun?.completionTokens ?? 0),
  });
}

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
      .where(
        sourceId
          ? and(eq(events.sourceId, sourceId), eq(events.status, "auto_rejected"))
          : and(eq(events.status, "auto_rejected"), isNotNull(events.sourceId)),
      )
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

  // Close the run out when the queue is empty. Leave the counters alone:
  // correctNextEvent already incremented them per event, and overwriting them
  // here with an all-time total made the run claim work it never did.
  if (result.done) {
    await db
      .update(runs)
      .set({ status: "completed", phase: "done", finishedAt: new Date() })
      .where(eq(runs.id, runId));
  }

  // Report the run's live totals back so the progress bar shows what the
  // database actually holds, not a number this tab has been counting on its own.
  const [progress] = await db
    .select({
      checked: runs.eventsFound,
      corrected: runs.eventsExtracted,
      costMicros: runs.costMicros,
      promptTokens: runs.promptTokens,
      completionTokens: runs.completionTokens,
    })
    .from(runs)
    .where(eq(runs.id, runId));

  return NextResponse.json({
    ...result,
    runId,
    checked: Number(progress?.checked ?? 0),
    corrected: Number(progress?.corrected ?? 0),
    costUsd: Number(progress?.costMicros ?? 0) / 1_000_000,
    tokens: Number(progress?.promptTokens ?? 0) + Number(progress?.completionTokens ?? 0),
  });
}
