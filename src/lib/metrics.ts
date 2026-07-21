import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { events, fieldEditLog, runs, sources } from "@/db/schema";

/** Minutes we estimate it takes a person to find and hand-enter one event. */
export const MINUTES_PER_MANUAL_EVENT = 6;

export type SourceMetric = {
  name: string;
  gathered: number;
  completeOnArrival: number; // arrived with every field filled
  duplicatesCaught: number;
  editsNeeded: number; // reviewer field edits recorded
};

export type PilotMetrics = {
  sourcesConnected: number;
  eventsGathered: number; // complete events handed to review (not counting caught duplicates)
  duplicatesCaught: number;
  filteredIncomplete: number; // events the system caught as incomplete before a person saw them
  completeOnArrivalPct: number; // of gathered events, how many needed no field added
  approvedAsIsPct: number | null; // of approved/published, share kept with no edits (null if none yet)
  approvedTotal: number;
  totalReviewerEdits: number;
  estimatedHoursSaved: number;
  runsCompleted: number;
  totalSpendUsd: number; // real API dollars, summed from what the Agent API billed
  costPerEventUsd: number; // spend divided by events gathered
  bySource: SourceMetric[];
};

function n(v: unknown): number {
  return Number(v ?? 0);
}

export async function pilotMetrics(): Promise<PilotMetrics> {
  // One row per (source, status) so we can slice every way the page needs.
  const rows = await db
    .select({
      sourceId: events.sourceId,
      status: events.status,
      flagged: sql<number>`sum(case when ${events.rejectionReason} is not null then 1 else 0 end)`,
      total: sql<number>`count(*)`,
    })
    .from(events)
    .groupBy(events.sourceId, events.status);

  const srcRows = await db.select({ id: sources.id, name: sources.name, active: sources.active }).from(sources);
  const nameOf = new Map(srcRows.map((s) => [s.id, s.name]));

  // Reviewer edits per event and per source (the human-correction signal).
  const editRows = await db
    .select({
      sourceId: fieldEditLog.sourceId,
      edits: sql<number>`count(*)`,
      eventsEdited: sql<number>`count(distinct ${fieldEditLog.eventId})`,
    })
    .from(fieldEditLog)
    .groupBy(fieldEditLog.sourceId);
  const editsBySource = new Map(editRows.map((r) => [r.sourceId, r]));
  const editedEventIds = await db
    .select({ id: fieldEditLog.eventId })
    .from(fieldEditLog)
    .groupBy(fieldEditLog.eventId);
  const editedSet = new Set(editedEventIds.map((r) => r.id));

  // Approved/published events, to compute the "kept as-is" rate.
  const approvedRows = await db
    .select({ id: events.id, status: events.status })
    .from(events)
    .where(sql`${events.status} in ('approved','submitted')`);
  const approvedTotal = approvedRows.length;
  const approvedAsIs = approvedRows.filter((e) => !editedSet.has(e.id)).length;

  const [runRow] = await db
    .select({
      completed: sql<number>`sum(case when ${runs.status} = 'completed' then 1 else 0 end)`,
      costMicros: sql<number>`sum(${runs.costMicros})`,
    })
    .from(runs);
  const totalSpendUsd = n(runRow?.costMicros) / 1_000_000;

  // Aggregate.
  // Events shown to a reviewer (pending/approved/submitted). Auto-rejected events
  // are the ones the system caught as incomplete BEFORE a person saw them, so they
  // are a separate figure, never mixed into the "complete on arrival" rate.
  const reviewStatuses = new Set(["pending", "approved", "submitted"]);
  let eventsGathered = 0;
  let duplicatesCaught = 0;
  let completeOnArrival = 0;
  let filteredIncomplete = 0;
  const perSource = new Map<number, SourceMetric>();

  for (const r of rows) {
    const sid = r.sourceId ?? -1;
    const name = nameOf.get(sid) ?? "Unknown";
    const s = perSource.get(sid) ?? { name, gathered: 0, completeOnArrival: 0, duplicatesCaught: 0, editsNeeded: 0 };
    const total = n(r.total);
    const flagged = n(r.flagged);

    if (r.status === "duplicate") {
      duplicatesCaught += total;
      s.duplicatesCaught += total;
    } else if (r.status === "auto_rejected") {
      filteredIncomplete += total;
    } else if (reviewStatuses.has(r.status ?? "")) {
      eventsGathered += total;
      completeOnArrival += total - flagged; // flagged = something still missing
      s.gathered += total;
      s.completeOnArrival += total - flagged;
    }
    perSource.set(sid, s);
  }

  for (const [sid, s] of perSource) {
    s.editsNeeded = n(editsBySource.get(sid)?.edits);
  }

  return {
    sourcesConnected: srcRows.filter((s) => s.active).length,
    eventsGathered,
    duplicatesCaught,
    filteredIncomplete,
    completeOnArrivalPct: eventsGathered ? Math.round((completeOnArrival / eventsGathered) * 100) : 0,
    approvedAsIsPct: approvedTotal ? Math.round((approvedAsIs / approvedTotal) * 100) : null,
    approvedTotal,
    totalReviewerEdits: editRows.reduce((a, r) => a + n(r.edits), 0),
    estimatedHoursSaved: Math.round((eventsGathered * MINUTES_PER_MANUAL_EVENT) / 60),
    runsCompleted: n(runRow?.completed),
    totalSpendUsd,
    costPerEventUsd: eventsGathered ? totalSpendUsd / eventsGathered : 0,
    bySource: [...perSource.values()].filter((s) => s.gathered > 0 || s.duplicatesCaught > 0).sort((a, b) => b.gathered - a.gathered),
  };
}
