/**
 * Vercel route ceiling for extraction and ingest handlers; 300s is the Hobby
 * plan's hard limit. A real extraction often needs longer than any budget that
 * fits under it, which is why the agent also delivers through the ingest
 * callback: the wait ending here no longer decides the run.
 */
export const SERVERLESS_ROUTE_BUDGET_MS = 300_000;

/**
 * Stop provider work early enough that a fallback response can still be
 * validated, persisted, and terminalized in the same invocation.
 */
// Must stay at least INGEST_PERSISTENCE_RESERVE_MS below the finalization
// deadline, so a run that uses its whole provider budget still has time to
// persist and terminalize. Raising this to 250s broke that invariant.
export const PROVIDER_PHASE_BUDGET_MS = 240_000;

/** Keep a final platform margin for terminal job/run writes. */
export const FINALIZATION_DEADLINE_MS = 290_000;

/** Once this much time remains, ingestion performs database work only. */
export const INGEST_PERSISTENCE_RESERVE_MS = 45_000;

export function remainingProviderBudget(deadlineAt: number, nowMs = Date.now()): number {
  const remaining = deadlineAt - nowMs - 10_000;
  if (remaining < 5_000) {
    throw new Error("Run reached its execution time budget; retry it.");
  }
  return remaining;
}

/** Time optional network enrichment may consume without stealing persistence time. */
export function optionalIngestBudget(
  deadlineAt: number | undefined,
  requestedMs: number,
  nowMs = Date.now(),
): number {
  if (deadlineAt == null) return Math.max(0, requestedMs);
  return Math.max(
    0,
    Math.min(requestedMs, deadlineAt - nowMs - INGEST_PERSISTENCE_RESERVE_MS),
  );
}
