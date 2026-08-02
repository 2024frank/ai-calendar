import { NextResponse } from "next/server";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { communities, runs, sources } from "@/db/schema";
import { verifyRunToken } from "@/lib/agentToken";
import { ingestEvents } from "@/lib/ingest";
import { emit } from "@/lib/runEvents";
import { readJsonBodyLimited, RequestBodyTooLargeError } from "@/lib/requestBody";
import { FINALIZATION_DEADLINE_MS } from "@/lib/extractionPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Legacy authenticated callback for an already-running external worker.
 *
 * The normal extraction path now receives structured model output and ingests
 * it in-process, so model prompts never contain this endpoint or a run token.
 * This endpoint remains fail-closed behind a per-run HMAC for compatibility;
 * callers still pass through the same validation and persistence pipeline.
 */
export async function POST(req: Request) {
  const deadlineAt = Date.now() + FINALIZATION_DEADLINE_MS;
  let body: {
    runId?: number;
    token?: string;
    events?: Record<string, unknown>[];
    duplicates?: Record<string, unknown>[];
  };
  try {
    body = await readJsonBodyLimited(req, 2 * 1024 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "payload too large" : "invalid JSON" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const runId = Number(body.runId);
  if (!Number.isInteger(runId) || !verifyRunToken(runId, String(body.token ?? ""))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run || !run.sourceId) return NextResponse.json({ error: "unknown run" }, { status: 404 });
  if (run.status !== "running") {
    return NextResponse.json({ error: "run is no longer accepting results" }, { status: 409 });
  }
  const [source] = await db.select().from(sources).where(eq(sources.id, run.sourceId)).limit(1);
  const [community] = source
    ? await db.select().from(communities).where(eq(communities.id, source.communityId)).limit(1)
    : [undefined];
  if (!source || !community) return NextResponse.json({ error: "source missing" }, { status: 404 });

  const kept = Array.isArray(body.events) ? body.events : [];
  const reportedDupes = Array.isArray(body.duplicates) ? body.duplicates : [];
  if (kept.length + reportedDupes.length > 500) {
    return NextResponse.json({ error: "too many events" }, { status: 413 });
  }

  // Claim this callback before ingesting. A leaked or replayed per-run token
  // cannot race a second copy of the same payload into the database.
  const [claim] = await db
    .update(runs)
    .set({ phase: "ingesting" })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.status, "running"),
        or(isNull(runs.phase), ne(runs.phase, "ingesting")),
      ),
    );
  if (Number((claim as { affectedRows?: number }).affectedRows ?? 0) !== 1) {
    return NextResponse.json({ error: "results are already being ingested" }, { status: 409 });
  }

  try {
    if (reportedDupes.length) {
      // The agent already found these on CommunityHub. Record that it saw them;
      // the ingest dedup below still confirms server-side.
      await emit(
        runId,
        "dedup_outcome",
        `Agent reported ${reportedDupes.length} item(s) already on CommunityHub`,
        { agentReportedDuplicates: reportedDupes.length },
      );
      for (const d of reportedDupes) {
        if (d && typeof d === "object") {
          const o = d as Record<string, unknown>;
          if (!("_agentDuplicateOf" in o)) {
            o._agentDuplicateOf = o.duplicateOfUrl ?? o.calendarSourceUrl ?? true;
          }
          if (!("_agentDuplicateOfId" in o) && o.duplicateOfEventId != null) {
            o._agentDuplicateOfId = Number(o.duplicateOfEventId);
          }
        }
      }
    }

    // One list through the normal pipeline: ISO dates become timestamps, the
    // server's own dedup runs, and each event lands as pending, duplicate, or
    // auto_rejected.
    const counts = await ingestEvents(runId, source, community, [...kept, ...reportedDupes], {
      deadlineAt,
    });

    await emit(
      runId,
      "run_finished",
      `Agent posted ${kept.length} event(s), ${reportedDupes.length} duplicate(s), ${counts.outsideLookahead} outside lookahead skipped`,
      {
        ...counts,
        posted: kept.length,
        reportedDuplicates: reportedDupes.length,
      },
    );

    // Reflect on the run row so the dashboard shows the outcome.
    await db
      .update(runs)
      .set({
        status: "completed",
        phase: "done",
        finishedAt: new Date(),
        eventsFound: counts.found,
        eventsExtracted: counts.inserted,
        eventsDuplicate: counts.duplicate,
        eventsInvalid: counts.invalid,
      })
      .where(eq(runs.id, runId));

    return NextResponse.json({ ok: true, ...counts });
  } catch (error) {
    await db
      .update(runs)
      .set({ phase: "fetching" })
      .where(and(eq(runs.id, runId), eq(runs.status, "running"), eq(runs.phase, "ingesting")));
    throw error;
  }
}

// A GET so the agent (and you) can confirm the endpoint is reachable.
export async function GET() {
  return NextResponse.json({ ok: true });
}
