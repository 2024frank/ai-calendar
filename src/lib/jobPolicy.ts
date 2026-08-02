export const STALE_JOB_LEASE_MS = 15 * 60_000;
export const QUEUED_JOB_MAX_WAIT_MS = 6 * 60 * 60_000;
export const QUEUED_RUN_DEADLINE_MS = 60 * 60_000;
export const MAX_DRAIN_BATCH = 5;
export const WORKER_DISPATCH_ATTEMPTS = 3;
export const MAX_WORKER_RECOVERY_DISPATCHES = 2;

export type RunLifecycleStatus = "running" | "completed" | "failed" | "stopped";

/** A terminal run always owns a terminal job; completed callbacks reconcile to success. */
export function terminalJobStatus(
  runStatus: RunLifecycleStatus,
): "succeeded" | "failed" | null {
  if (runStatus === "completed") return "succeeded";
  if (runStatus === "failed" || runStatus === "stopped") return "failed";
  return null;
}

export function drainBatchSize(requested: number): number {
  return Math.min(Math.max(Math.floor(requested), 1), MAX_DRAIN_BATCH);
}

/** Continue a serverless worker chain only after it actually claimed work. */
export function shouldContinueWorkerChain(considered: number, remaining: number): boolean {
  return considered > 0 && remaining > 0;
}

export function workerRecoveryAttempt(raw: string | null | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, MAX_WORKER_RECOVERY_DISPATCHES);
}

/** Bound error-only redispatches so a database outage cannot recurse forever. */
export function nextWorkerRecoveryAttempt(current: number): number | null {
  const normalized = workerRecoveryAttempt(String(current));
  return normalized < MAX_WORKER_RECOVERY_DISPATCHES ? normalized + 1 : null;
}
