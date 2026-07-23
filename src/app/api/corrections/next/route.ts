import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, runs } from "@/db/schema";
import { correctNextEvent } from "@/lib/correction";
import { getSession, isAdmin } from "@/lib/auth";
import { currentCommunityId, getSource } from "@/lib/data";

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
  if (sourceId && !(await getSource(s, sourceId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const communityId = await currentCommunityId(s);
  const eventScope = communityId ? eq(events.communityId, communityId) : undefined;
  const runScope = communityId ? eq(runs.communityId, communityId) : undefined;
  const untried = sql`(${events.rejectionReason} is null or ${events.rejectionReason} not like '%[tried]%')`;

  const [remainingRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(
      sourceId
        ? and(eventScope, eq(events.sourceId, sourceId), eq(events.status, "auto_rejected"), untried)
        : and(eventScope, eq(events.status, "auto_rejected"), untried),
    );
  const [attemptedRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(
      sourceId
        ? and(
            eventScope,
            eq(events.sourceId, sourceId),
            eq(events.status, "auto_rejected"),
            sql`${events.rejectionReason} like '%[tried]%'`,
          )
        : and(
            eventScope,
            eq(events.status, "auto_rejected"),
            sql`${events.rejectionReason} like '%[tried]%'`,
          ),
    );

  const [correctedRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(
      sourceId
        ? and(eventScope, eq(events.sourceId, sourceId), isNotNull(events.correctedAt))
        : and(eventScope, isNotNull(events.correctedAt)),
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
        ? and(
            runScope,
            eq(runs.runKind, "correction"),
            eq(runs.status, "running"),
            eq(runs.sourceId, sourceId),
          )
        : and(runScope, eq(runs.runKind, "correction"), eq(runs.status, "running")),
    )
    .orderBy(desc(runs.id))
    .limit(1);

  return NextResponse.json({
    remaining: Number(remainingRow?.n ?? 0),
    // Already attempted and parked. Nothing picks these up again on its own,
    // so the button offers them explicitly rather than looking finished.
    attempted: Number(attemptedRow?.n ?? 0),
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

  const body = (await req.json().catch(() => ({}))) as {
    runId?: number;
    sourceId?: number;
    retryAttempted?: boolean;
  };
  const sourceId = body.sourceId ? Number(body.sourceId) : null;
  if (sourceId && !(await getSource(s, sourceId))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const activeCommunityId = await currentCommunityId(s);
  const eventScope = activeCommunityId
    ? eq(events.communityId, activeCommunityId)
    : undefined;

  // An event that could not be completed is parked with a [tried] marker so a
  // pass cannot loop on it forever. Nothing ever cleared those, so once every
  // event had been attempted the button had nothing left to do and looked
  // broken. Asking to retry unparks them, which is what you want after the
  // agent itself has been improved.
  if (body.retryAttempted) {
    const parked = sql`${events.rejectionReason} like '%[tried]%'`;
    await db
      .update(events)
      .set({ rejectionReason: sql`replace(${events.rejectionReason}, ' [tried]', '')` })
      .where(
        sourceId
          ? and(
              eventScope,
              eq(events.sourceId, sourceId),
              eq(events.status, "auto_rejected"),
              parked,
            )
          : and(eventScope, eq(events.status, "auto_rejected"), parked),
      );
  }

  // Nothing to work on: say so without opening a run. Every click used to
  // create an empty run row whether or not there was anything to do.
  const untried = sql`(${events.rejectionReason} is null or ${events.rejectionReason} not like '%[tried]%')`;
  const [work] = await db
    .select({ n: sql<number>`count(*)` })
    .from(events)
    .where(
      sourceId
        ? and(
            eventScope,
            eq(events.sourceId, sourceId),
            eq(events.status, "auto_rejected"),
            untried,
          )
        : and(
            eventScope,
            eq(events.status, "auto_rejected"),
            isNotNull(events.sourceId),
            untried,
          ),
    );
  if (!Number(work?.n ?? 0)) {
    return NextResponse.json({
      done: true,
      fixed: false,
      title: null,
      remaining: 0,
      runId: Number(body.runId) || 0,
      checked: 0,
      corrected: 0,
      costUsd: 0,
      tokens: 0,
    });
  }

  // Reuse the caller's run so the whole pass shares one timeline and one cost
  // total; start one on the first call.
  let runId = Number(body.runId);
  let correctionCommunityId = activeCommunityId;
  if (Number.isInteger(runId) && runId > 0) {
    const [existingRun] = await db
      .select({
        sourceId: runs.sourceId,
        communityId: runs.communityId,
        runKind: runs.runKind,
        status: runs.status,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    const invalidRun =
      !existingRun ||
      existingRun.runKind !== "correction" ||
      existingRun.status !== "running" ||
      (activeCommunityId !== null && existingRun.communityId !== activeCommunityId) ||
      (sourceId !== null && existingRun.sourceId !== sourceId);
    if (invalidRun) {
      return NextResponse.json({ error: "correction run not found" }, { status: 404 });
    }
    correctionCommunityId = existingRun.communityId;
  } else {
    const [first] = await db
      .select({ sourceId: events.sourceId, communityId: events.communityId })
      .from(events)
      .where(
        sourceId
          ? and(eventScope, eq(events.sourceId, sourceId), eq(events.status, "auto_rejected"))
          : and(eventScope, eq(events.status, "auto_rejected"), isNotNull(events.sourceId)),
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
    correctionCommunityId = first.communityId;
  }

  const result = await correctNextEvent(runId, sourceId, correctionCommunityId);

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
