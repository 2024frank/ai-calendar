import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, events, fieldEditLog, runEvents, runs, sources } from "@/db/schema";
import { REVIEWER_ONLY_FIELDS } from "./taxonomy";
import { activeModel } from "./models";

/** Minutes we estimate it takes a person to find and hand-enter one event. */
export const MINUTES_PER_MANUAL_EVENT = 6;

export type SourceMetric = {
  name: string;
  gathered: number;
  currentUnflagged: number; // current records with no stored rejection reason
  duplicatesCaught: number;
  editsNeeded: number; // reviewer field edits recorded
};

export type PilotMetrics = {
  sourcesConnected: number;
  eventsGathered: number; // lifetime: every record the system handed to review
  duplicatesCaught: number; // lifetime: every incoming event judged a duplicate
  reviewerApproved: number; // lifetime: events whose latest reviewer decision is approve
  reviewerRejected: number; // lifetime: events whose latest reviewer decision is reject
  approvalRatePct: number | null;
  filteredIncomplete: number; // events the system caught as incomplete before a person saw them
  currentUnflaggedPct: number | null; // mutable operational state, not arrival accuracy
  approvedAsIsPct: number | null; // lifetime approvals with no reviewer correction before approving
  approvedTotal: number;
  totalReviewerEdits: number;
  estimatedHoursSaved: number;
  runsCompleted: number;
  totalSpendUsd: number; // real API dollars, summed from what the Agent API billed
  costPerEventUsd: number; // spend divided by events gathered
  correctedCount: number; // records with a correction timestamp, including reviewer-requested corrections
  correctedAccepted: number; // of those, how many a reviewer later approved/published
  bySource: SourceMetric[];
  byModel: ModelMetric[];
  activeModel: string;
};

export type ModelMetric = {
  model: string;
  runs: number;
  eventsExtracted: number;
  costUsd: number;
  costPerEventUsd: number; // the money question: cheaper per usable event
  cleanPct: number | null; // extraction-only validation share, unavailable when nothing was found
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
    .where(sql`${fieldEditLog.fieldName} not in (${sql.join([...REVIEWER_ONLY_FIELDS].map((f) => sql`${f}`), sql`, `)})`)
    .groupBy(fieldEditLog.sourceId);
  const editsBySource = new Map(editRows.map((r) => [r.sourceId, r]));

  // Reviewer decisions come from the audit log, never from the events table.
  // The nightly sweep deletes an event once its date has passed, and its
  // approval or rejection went with it: this page once showed 43 approvals
  // when reviewers had made 101, and no rejections at all. activity_log has no
  // foreign key to events, so it keeps every decision. An event decided twice
  // (rejected, then approved) counts once, by its latest decision.
  const decisions = await db
    .select({ logId: activityLog.id, id: activityLog.targetId, action: activityLog.action })
    .from(activityLog)
    .where(sql`${activityLog.action} in ('approve','reject') and ${activityLog.targetType} = 'event'`);
  const latest = new Map<number, { logId: number; action: string }>();
  for (const d of decisions) {
    if (d.id == null) continue;
    const seen = latest.get(d.id);
    if (!seen || Number(d.logId) > seen.logId) latest.set(d.id, { logId: Number(d.logId), action: d.action });
  }
  const approvals = [...latest].filter(([, d]) => d.action === "approve");
  const reviewerApproved = approvals.length;
  const reviewerRejected = latest.size - reviewerApproved;
  const approvedTotal = reviewerApproved;

  // "Approved without edits" means the reviewer corrected nothing the agent
  // produced before approving. Read from the audit log too, since field_edit_log
  // loses its event link when the sweep deletes the event. Fields the agent is
  // never asked to produce are not corrections of its work.
  const editLog = await db
    .select({ logId: activityLog.id, id: activityLog.targetId, detail: activityLog.detail })
    .from(activityLog)
    .where(sql`${activityLog.action} = 'edit' and ${activityLog.targetType} = 'event'`);
  const correctedBefore = new Map<number, number[]>();
  for (const r of editLog) {
    if (r.id == null) continue;
    const detail = (typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail) as { fields?: string[] } | null;
    const fields = (detail?.fields ?? []).filter((f) => !REVIEWER_ONLY_FIELDS.has(f));
    if (!fields.length) continue;
    correctedBefore.set(r.id, [...(correctedBefore.get(r.id) ?? []), Number(r.logId)]);
  }
  const approvedAsIs = approvals.filter(
    ([id, d]) => !(correctedBefore.get(id) ?? []).some((logId) => logId < d.logId),
  ).length;

  // Lifetime intake, from the run timeline. Runs are never deleted, so these
  // outcomes survive the sweep that removes the events themselves.
  const [intake] = await db
    .select({
      sent: sql<number>`sum(case when ${runEvents.kind} = 'queue_outcome' and ${runEvents.label} like 'Sent to review%' then 1 else 0 end)`,
      dups: sql<number>`sum(case when ${runEvents.kind} = 'dedup_outcome' and ${runEvents.label} like 'Duplicate%' then 1 else 0 end)`,
    })
    .from(runEvents);

  const [runRow] = await db
    .select({
      completed: sql<number>`sum(case when ${runs.status} = 'completed' then 1 else 0 end)`,
      costMicros: sql<number>`sum(${runs.costMicros})`,
    })
    .from(runs);
  const totalSpendUsd = n(runRow?.costMicros) / 1_000_000;

  // Correction timestamps do not distinguish original auto-rejections from
  // reviewer-requested corrections. Neither count proves correctness.
  const [corrRow] = await db
    .select({
      total: sql<number>`count(*)`,
      accepted: sql<number>`sum(case when ${events.status} in ('approved','submitted') and ${events.publishedVia} = 'reviewer' then 1 else 0 end)`,
    })
    .from(events)
    .where(sql`${events.correctedAt} is not null`);

  // Only extraction runs use the found/invalid/extracted counters comparably.
  const modelRows = await db
    .select({
      model: runs.model,
      runs: sql<number>`count(*)`,
      found: sql<number>`sum(${runs.eventsFound})`,
      extracted: sql<number>`sum(${runs.eventsExtracted})`,
      invalid: sql<number>`sum(${runs.eventsInvalid})`,
      costMicros: sql<number>`sum(${runs.costMicros})`,
    })
    .from(runs)
    .where(sql`${runs.model} is not null and ${runs.runKind} = 'extraction'`)
    .groupBy(runs.model);
  const byModel: ModelMetric[] = modelRows
    .map((r) => {
      const extracted = n(r.extracted);
      const found = n(r.found);
      const costUsd = n(r.costMicros) / 1_000_000;
      return {
        model: r.model ?? "unknown",
        runs: n(r.runs),
        eventsExtracted: extracted,
        costUsd,
        costPerEventUsd: extracted ? costUsd / extracted : 0,
        cleanPct: found ? Math.round(((found - n(r.invalid)) / found) * 100) : null,
      };
    })
    .sort((a, b) => b.eventsExtracted - a.eventsExtracted);
  const chosenModel = await activeModel();

  // Aggregate.
  // Events shown to a reviewer (pending/approved/submitted). Auto-rejected events
  // are the ones the system caught as incomplete BEFORE a person saw them, so they
  // are a separate current-state count, not an immutable arrival measure.
  const reviewStatuses = new Set(["pending", "approved", "submitted"]);
  let eventsGathered = 0;
  let duplicatesCaught = 0;
  let currentUnflagged = 0;
  let filteredIncomplete = 0;
  const perSource = new Map<number, SourceMetric>();

  for (const r of rows) {
    const sid = r.sourceId ?? -1;
    const name = nameOf.get(sid) ?? "Unknown";
    const s = perSource.get(sid) ?? { name, gathered: 0, currentUnflagged: 0, duplicatesCaught: 0, editsNeeded: 0 };
    const total = n(r.total);
    const flagged = n(r.flagged);

    if (r.status === "duplicate") {
      duplicatesCaught += total;
      s.duplicatesCaught += total;
    } else if (r.status === "auto_rejected") {
      filteredIncomplete += total;
    } else if (reviewStatuses.has(r.status ?? "")) {
      eventsGathered += total;
      currentUnflagged += total - flagged;
      s.gathered += total;
      s.currentUnflagged += total - flagged;
    }
    perSource.set(sid, s);
  }

  for (const [sid, s] of perSource) {
    s.editsNeeded = n(editsBySource.get(sid)?.edits);
  }

  const lifetimeGathered = Math.max(n(intake?.sent), eventsGathered);
  const lifetimeDuplicates = Math.max(n(intake?.dups), duplicatesCaught);

  return {
    sourcesConnected: srcRows.filter((s) => s.active).length,
    eventsGathered: lifetimeGathered,
    duplicatesCaught: lifetimeDuplicates,
    reviewerApproved,
    reviewerRejected,
    approvalRatePct:
      reviewerApproved + reviewerRejected
        ? Math.round((reviewerApproved / (reviewerApproved + reviewerRejected)) * 100)
        : null,
    filteredIncomplete,
    currentUnflaggedPct: eventsGathered ? Math.round((currentUnflagged / eventsGathered) * 100) : null,
    approvedAsIsPct: approvedTotal ? Math.round((approvedAsIs / approvedTotal) * 100) : null,
    approvedTotal,
    totalReviewerEdits: editRows.reduce((a, r) => a + n(r.edits), 0),
    estimatedHoursSaved: Math.round((lifetimeGathered * MINUTES_PER_MANUAL_EVENT) / 60),
    runsCompleted: n(runRow?.completed),
    totalSpendUsd,
    costPerEventUsd: lifetimeGathered ? totalSpendUsd / lifetimeGathered : 0,
    correctedCount: n(corrRow?.total),
    correctedAccepted: n(corrRow?.accepted),
    byModel,
    activeModel: chosenModel,
    bySource: [...perSource.values()].filter((s) => s.gathered > 0 || s.duplicatesCaught > 0).sort((a, b) => b.gathered - a.gathered),
  };
}
