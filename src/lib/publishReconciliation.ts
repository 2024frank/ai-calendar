export const UNRESOLVED_PUBLISH_STATES = ["sending", "accepted_unreconciled"] as const;
export const SENDING_RECONCILIATION_DELAY_MS = 2 * 60_000;

export type PublishReconciliationOutcome = "published" | "not_published";

export function parsePublishReconciliationOutcome(
  value: unknown,
): PublishReconciliationOutcome | null {
  return value === "published" || value === "not_published" ? value : null;
}

export function isUnresolvedPublishState(value: unknown): boolean {
  return UNRESOLVED_PUBLISH_STATES.includes(
    value as (typeof UNRESOLVED_PUBLISH_STATES)[number],
  );
}

/** Never let a reviewer race the request that may still be sending. */
export function publishSubmissionCanBeReconciled(
  state: unknown,
  updatedAt: Date | string | number,
  nowMs = Date.now(),
): boolean {
  if (state === "accepted_unreconciled") return true;
  if (state !== "sending") return false;
  const updatedMs = new Date(updatedAt).getTime();
  return (
    Number.isFinite(updatedMs) &&
    updatedMs <= nowMs - SENDING_RECONCILIATION_DELAY_MS
  );
}

export function reconciliationTransition(outcome: PublishReconciliationOutcome): {
  submissionState: "succeeded" | "failed";
  eventStatus: "approved" | null;
} {
  return outcome === "published"
    ? { submissionState: "succeeded", eventStatus: "approved" }
    : { submissionState: "failed", eventStatus: null };
}
