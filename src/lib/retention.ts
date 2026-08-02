import "server-only";
import { and, eq, inArray, isNotNull, lt, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { communities, events, runs, sources } from "@/db/schema";
import { scheduledSourceIsDue } from "./schedule";

/**
 * Delete events once their date has passed. Every event whose start time is in
 * the past is removed, in every status, approved and submitted included: the
 * calendar shows what is upcoming, not a permanent archive. For an event with
 * more than one date, start_time_max stores its latest end, so it stays until
 * it is fully over. Events with no date are left alone.
 */
export async function sweepExpiredEvents(nowSecs = Math.floor(Date.now() / 1000)) {
  const [res] = await db
    .delete(events)
    .where(and(isNotNull(events.startTimeMax), lt(events.startTimeMax, nowSecs)));
  return (res as { affectedRows?: number }).affectedRows ?? 0;
}

/**
 * Fail runs that died without saying so. A serverless run killed by the
 * platform's time limit never updates its own row, so it sits "running"
 * forever and a discovery leaves its source stuck on "discovering". Any run
 * still "running" past its deadline, or silent for 15 minutes, is dead: mark
 * it failed and put its source back to a re-triable state. Correction passes
 * are the exception, since idleness there just means nobody is clicking.
 */
export async function reapStaleRuns(nowMs = Date.now()) {
  // Extraction runs are owned by the durable queue. Its lease recovery is the
  // only code allowed to retry or terminalize them while a queued/running job
  // exists; the generic reaper handles orphan runs only.
  const hasNoActiveJob = sql`not exists (
    select 1 from jobs j
    where j.run_id = ${runs.id} and j.status in ('queued', 'running')
  )`;
  const stale = await db
    .select({ id: runs.id, sourceId: runs.sourceId, kind: runs.runKind })
    .from(runs)
    .where(
      and(
        eq(runs.status, "running"),
        hasNoActiveJob,
        lt(runs.deadlineAt, new Date(nowMs)),
      ),
    );

  const silent = await db
    .select({ id: runs.id, sourceId: runs.sourceId, kind: runs.runKind })
    .from(runs)
    .where(
      and(
        eq(runs.status, "running"),
        hasNoActiveJob,
        // Without this guard, a brand-new run with no timeline rows yet is
        // immediately considered silent and failed on the next page load.
        lt(runs.startedAt, new Date(nowMs - 15 * 60_000)),
        sql`not exists (select 1 from run_events re where re.run_id = ${runs.id} and re.ts > ${new Date(nowMs - 15 * 60_000)})`,
      ),
    );

  const dead = [...new Map([...stale, ...silent].map((r) => [r.id, r])).values()];
  if (!dead.length) return 0;

  // A correction pass is driven by a person clicking, so it sits quiet whenever
  // they pause or close the tab. That is not a failure, and calling it one put
  // "failed" on a pass whose events had all been corrected. Close those as
  // completed; every event it finished is already out of the queue, and any it
  // did not are still marked for the next pass.
  const corrections = dead.filter((r) => r.kind === "correction").map((r) => r.id);
  const failures = dead.filter((r) => r.kind !== "correction").map((r) => r.id);

  if (corrections.length) {
    await db
      .update(runs)
      .set({ status: "completed", phase: "done", finishedAt: new Date(nowMs) })
      .where(inArray(runs.id, corrections));
  }
  if (failures.length) {
    await db
      .update(runs)
      .set({ status: "failed", phase: "done", finishedAt: new Date(nowMs) })
      .where(inArray(runs.id, failures));
  }

  // A discovery that died leaves its source claiming "discovering"; flip it to
  // failed so the UI says so and Re-discover becomes the obvious next step.
  const discoverySources = dead.filter((r) => r.kind === "discovery" && r.sourceId).map((r) => r.sourceId as number);
  if (discoverySources.length) {
    await db
      .update(sources)
      .set({ discoveryStatus: "failed" })
      .where(and(inArray(sources.id, discoverySources), eq(sources.discoveryStatus, "discovering")));
  }
  return dead.length;
}

/** Active, scheduled sources whose interval has elapsed since their last run. */
export async function dueScheduledSources(nowMs = Date.now()) {
  const rows = await db
    .select({ source: sources, timeZone: communities.timezone })
    .from(sources)
    .innerJoin(communities, eq(communities.id, sources.communityId))
    .where(
      and(
        eq(sources.active, true),
        isNotNull(sources.scheduleCron),
        eq(communities.status, "active"),
      ),
    );

  if (!rows.length) return [];

  const lastRuns = await db
    .select({ sourceId: runs.sourceId, last: max(runs.startedAt) })
    .from(runs)
    .where(
      and(
        inArray(
          runs.sourceId,
          rows.map((r) => r.source.id),
        ),
        eq(runs.runKind, "extraction"),
        eq(runs.status, "completed"),
      ),
    )
    .groupBy(runs.sourceId);
  const lastBySource = new Map(lastRuns.map((r) => [r.sourceId, r.last]));

  const due: (typeof sources.$inferSelect)[] = [];
  for (const row of rows) {
    const s = row.source;
    if (s.discoveryStatus !== "ready") continue; // no recipe yet — Discovery runs first
    const last = lastBySource.get(s.id);
    if (scheduledSourceIsDue(s.scheduleCron, last, nowMs, row.timeZone)) due.push(s);
  }
  return due;
}
