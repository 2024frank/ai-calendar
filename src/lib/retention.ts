import "server-only";
import { and, eq, inArray, isNotNull, lt, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, runs, sources } from "@/db/schema";
import { cronToValue } from "./schedule";

/**
 * Delete events whose start date has passed and that were never published.
 * Approved/submitted events are kept as a record; everything else that is in
 * the past (pending, duplicate, rejected) is purged.
 */
export async function sweepExpiredEvents(nowSecs = Math.floor(Date.now() / 1000)) {
  const [res] = await db
    .delete(events)
    .where(
      and(
        isNotNull(events.startTimeMax),
        lt(events.startTimeMax, nowSecs),
        sql`${events.status} not in ('approved','submitted')`,
      ),
    );
  return (res as { affectedRows?: number }).affectedRows ?? 0;
}

// Minimum spacing per schedule choice, so a frequent cron tick can't double-run
// a source. Values are ~90% of the nominal interval to allow for tick jitter.
const MIN_INTERVAL_SECS: Record<string, number> = {
  twice_daily: 11 * 3600,
  daily: 22 * 3600,
  weekdays: 22 * 3600,
  every_3_days: 65 * 3600,
  weekly: 160 * 3600,
};

/** Active, scheduled sources whose interval has elapsed since their last run. */
export async function dueScheduledSources(nowMs = Date.now()) {
  const rows = await db
    .select()
    .from(sources)
    .where(and(eq(sources.active, true), isNotNull(sources.scheduleCron)));

  if (!rows.length) return [];

  const lastRuns = await db
    .select({ sourceId: runs.sourceId, last: max(runs.startedAt) })
    .from(runs)
    .where(
      inArray(
        runs.sourceId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(runs.sourceId);
  const lastBySource = new Map(lastRuns.map((r) => [r.sourceId, r.last]));

  const due: typeof rows = [];
  for (const s of rows) {
    if (s.discoveryStatus !== "ready") continue; // no recipe yet — Discovery runs first
    const interval = MIN_INTERVAL_SECS[cronToValue(s.scheduleCron)] ?? 22 * 3600;
    const last = lastBySource.get(s.id);
    const lastMs = last ? new Date(last as unknown as string).getTime() : 0;
    if (nowMs - lastMs >= interval * 1000) due.push(s);
  }
  return due;
}
