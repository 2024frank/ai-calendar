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
  gathered: number; // lifetime: every new event this source ever produced
  current: number; // records still stored (finished events are swept away)
  currentUnflagged: number; // of `current`, those with no stored rejection reason
  duplicatesCaught: number;
  accepted: number; // reviewer approvals, latest decision per event
  autoPublished: number; // published automatically, no reviewer involved
  rejected: number; // reviewer rejections, latest decision per event
  autoRejected: number; // filtered out as incomplete before review, lifetime
  reviewed: number; // events a reviewer approved or rejected
  editsNeeded: number; // reviewer field edits recorded
};

export type PilotMetrics = {
  sourcesConnected: number;
  eventsGathered: number; // lifetime: every new event the system produced
  duplicatesCaught: number; // lifetime: every incoming event judged a duplicate
  reviewerApproved: number; // lifetime: events whose latest reviewer decision is approve
  reviewerRejected: number; // lifetime: events whose latest reviewer decision is reject
  autoPublished: number; // lifetime: published automatically, no reviewer involved
  eventsAccepted: number; // reviewerApproved + autoPublished: everything that reached the calendar
  autoRejectedLifetime: number; // lifetime: filtered as incomplete and never gathered
  awaitingDecision: number; // gathered but neither accepted nor rejected yet
  totalFound: number; // accepted + rejected + awaiting + duplicates + incomplete: every candidate processed
  monthlyGathered: { month: string; gathered: number }[]; // new events per month, earliest first
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

  // Which source each decided event came from. The sweep deletes the event, so
  // the run log (every new event's queue_outcome names its id, and the run
  // names its source) is the lasting record; stored events fill any gap.
  // One classification per event, from the run timeline. An event can earn
  // several queue_outcome rows over its life (auto-rejected, then corrected
  // and re-queued), so counting rows or independent aggregates double-counts
  // it and the outcome totals stop adding up. Classify each distinct event
  // once instead: gathered if it ever proceeded as a new event, incomplete
  // only if it never did.
  const origins = await db
    .selectDistinct({
      sourceId: runs.sourceId,
      eventId: sql<number>`cast(json_extract(${runEvents.data}, '$.eventId') as unsigned)`,
      bucket: sql<string>`case when ${runEvents.label} like 'Auto-rejected%' then 'incomplete' when ${runEvents.label} like 'Kept as duplicate%' or ${runEvents.label} like 'New dates kept%' then 'excluded' else 'gathered' end`,
      month: sql<string>`date_format(${runs.startedAt}, '%Y-%m')`,
    })
    .from(runEvents)
    .innerJoin(runs, sql`${runs.id} = ${runEvents.runId}`)
    .where(sql`${runEvents.kind} = 'queue_outcome'`);
  const sourceOfEvent = new Map<number, number>();
  const gatheredEvents = new Map<number, { sourceId: number; month: string }>();
  const incompleteEvents = new Map<number, number>();
  for (const o of origins) {
    if (o.eventId == null || o.sourceId == null) continue;
    const eventId = Number(o.eventId);
    sourceOfEvent.set(eventId, o.sourceId);
    if (o.bucket === "gathered") {
      const seen = gatheredEvents.get(eventId);
      if (!seen || String(o.month) < seen.month) gatheredEvents.set(eventId, { sourceId: o.sourceId, month: String(o.month) });
      incompleteEvents.delete(eventId);
    } else if (o.bucket === "incomplete" && !gatheredEvents.has(eventId)) {
      incompleteEvents.set(eventId, o.sourceId);
    }
  }
  const gatheredBySource = new Map<number, number>();
  const monthlyMap = new Map<string, number>();
  for (const g of gatheredEvents.values()) {
    gatheredBySource.set(g.sourceId, (gatheredBySource.get(g.sourceId) ?? 0) + 1);
    monthlyMap.set(g.month, (monthlyMap.get(g.month) ?? 0) + 1);
  }
  const incompleteBySource = new Map<number, number>();
  for (const sid of incompleteEvents.values()) incompleteBySource.set(sid, (incompleteBySource.get(sid) ?? 0) + 1);
  const stored = await db.select({ id: events.id, sourceId: events.sourceId }).from(events);
  for (const e of stored) if (e.sourceId != null) sourceOfEvent.set(e.id, e.sourceId);
  const decisionsBySource = new Map<number, { accepted: number; rejected: number; reviewed: number }>();
  for (const [eventId, d] of latest) {
    const sid = sourceOfEvent.get(eventId) ?? -1;
    const tally = decisionsBySource.get(sid) ?? { accepted: 0, rejected: 0, reviewed: 0 };
    tally.reviewed += 1;
    if (d.action === "approve") tally.accepted += 1;
    else tally.rejected += 1;
    decisionsBySource.set(sid, tally);
  }

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

  // Lifetime intake per source, from the run timeline. Runs are never deleted,
  // so these outcomes survive the sweep that removes finished events. Every
  // queue_outcome for a new event that reached the calendar counts, whatever
  // happened next (sent to review, auto-published, or left for review after a
  // failed send); counting only "Sent to review" missed every auto-published
  // event. Duplicates, auto-rejections and new-date proposals on an existing
  // event write the same kind but never reached the calendar as new events.
  const dupRows = await db
    .select({
      sourceId: runs.sourceId,
      dups: sql<number>`count(*)`,
    })
    .from(runEvents)
    .innerJoin(runs, sql`${runs.id} = ${runEvents.runId}`)
    .where(sql`${runEvents.kind} = 'dedup_outcome' and ${runEvents.label} like 'Duplicate%'`)
    .groupBy(runs.sourceId);
  const dupsBySource = new Map(dupRows.map((r) => [r.sourceId ?? -1, n(r.dups)]));

  // Automatic publishes never pass a reviewer, so the audit log cannot see
  // them. The per-run counter is the lifetime record; runs are never swept.
  const pubRows = await db
    .select({
      sourceId: runs.sourceId,
      published: sql<number>`sum(${runs.eventsPublished})`,
    })
    .from(runs)
    .groupBy(runs.sourceId);
  const publishedBySource = new Map(pubRows.map((r) => [r.sourceId ?? -1, n(r.published)]));
  const autoPublished = pubRows.reduce((a, r) => a + n(r.published), 0);

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
  // Events that reached the calendar: shown to a reviewer (pending, approved,
  // submitted, rejected) or published automatically. Auto-rejected events are
  // the ones the system caught as incomplete BEFORE a person saw them, so they
  // are a separate current-state count, not an immutable arrival measure.
  const reviewStatuses = new Set(["pending", "approved", "submitted", "rejected", "published"]);
  let eventsGathered = 0;
  let currentUnflagged = 0;
  let filteredIncomplete = 0;
  const perSource = new Map<number, SourceMetric>();

  for (const r of rows) {
    const sid = r.sourceId ?? -1;
    const name = nameOf.get(sid) ?? "Unknown";
    const s = perSource.get(sid) ?? { name, gathered: 0, current: 0, currentUnflagged: 0, duplicatesCaught: 0, accepted: 0, autoPublished: 0, rejected: 0, autoRejected: 0, reviewed: 0, editsNeeded: 0 };
    const total = n(r.total);
    const flagged = n(r.flagged);

    if (r.status === "duplicate") {
      s.duplicatesCaught += total;
    } else if (r.status === "auto_rejected") {
      filteredIncomplete += total;
    } else if (reviewStatuses.has(r.status ?? "")) {
      eventsGathered += total;
      currentUnflagged += total - flagged;
      s.current += total;
      s.currentUnflagged += total - flagged;
    }
    perSource.set(sid, s);
  }

  // Sources whose events have all been swept still count for what they gathered.
  for (const sid of [...gatheredBySource.keys(), ...incompleteBySource.keys(), ...dupsBySource.keys(), ...decisionsBySource.keys()]) {
    if (!perSource.has(sid)) {
      perSource.set(sid, { name: nameOf.get(sid) ?? "Unknown", gathered: 0, current: 0, currentUnflagged: 0, duplicatesCaught: 0, accepted: 0, autoPublished: 0, rejected: 0, autoRejected: 0, reviewed: 0, editsNeeded: 0 });
    }
  }
  // Lifetime per source; the stored rows are a floor for events older than the
  // run timeline.
  let lifetimeGathered = 0;
  let lifetimeDuplicates = 0;
  let lifetimeIncomplete = 0;
  for (const [sid, s] of perSource) {
    s.gathered = Math.max(gatheredBySource.get(sid) ?? 0, s.current);
    s.duplicatesCaught = Math.max(dupsBySource.get(sid) ?? 0, s.duplicatesCaught);
    s.accepted = decisionsBySource.get(sid)?.accepted ?? 0;
    s.rejected = decisionsBySource.get(sid)?.rejected ?? 0;
    s.autoPublished = publishedBySource.get(sid) ?? 0;
    s.autoRejected = incompleteBySource.get(sid) ?? 0;
    s.reviewed = decisionsBySource.get(sid)?.reviewed ?? 0;
    s.editsNeeded = n(editsBySource.get(sid)?.edits);
    lifetimeGathered += s.gathered;
    lifetimeDuplicates += s.duplicatesCaught;
    lifetimeIncomplete += s.autoRejected;
  }

  // The five outcome buckets partition everything the system ever processed,
  // so the presentation numbers reconcile by construction.
  const eventsAccepted = reviewerApproved + autoPublished;
  const awaitingDecision = Math.max(0, lifetimeGathered - eventsAccepted - reviewerRejected);
  const totalFound = eventsAccepted + reviewerRejected + awaitingDecision + lifetimeDuplicates + lifetimeIncomplete;

  return {
    sourcesConnected: srcRows.filter((s) => s.active).length,
    eventsGathered: lifetimeGathered,
    duplicatesCaught: lifetimeDuplicates,
    reviewerApproved,
    reviewerRejected,
    autoPublished,
    eventsAccepted,
    autoRejectedLifetime: lifetimeIncomplete,
    awaitingDecision,
    totalFound,
    monthlyGathered: [...monthlyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, gathered]) => ({ month, gathered })),
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
    bySource: [...perSource.values()].filter((s) => s.gathered > 0 || s.duplicatesCaught > 0 || s.autoRejected > 0).sort((a, b) => b.gathered - a.gathered),
  };
}
