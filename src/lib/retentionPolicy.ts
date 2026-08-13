/**
 * When an event has stopped being worth keeping.
 *
 * Kept apart from `retention.ts` so the rules can be reasoned about and tested
 * without a database, matching how the other policy modules here are split.
 */

/** How long a dateless leftover may sit before it is cleared out. */
export const DATELESS_RETENTION_DAYS = 60;

/** Statuses that are leftovers rather than work in progress. */
export const DATELESS_SWEEPABLE_STATUSES = ["auto_rejected", "duplicate"] as const;

/**
 * An event is over when its LATEST session end has passed.
 *
 * The stored column is called start_time_max for historical reasons but holds
 * the latest END, which is what makes a run of several dates survive until the
 * final one is finished, and a long exhibition survive until it closes.
 */
export function isExpiredByDate(
  startTimeMax: number | null | undefined,
  nowSecs: number,
): boolean {
  return typeof startTimeMax === "number" && startTimeMax < nowSecs;
}

/**
 * A row with no date at all can never expire on its own, so it stayed forever
 * and reviewers kept seeing it. Age is the only fair rule for those, and only
 * for leftovers: anything a person is still working with is never swept on age.
 */
export function isExpiredByAge(
  startTimeMax: number | null | undefined,
  status: string,
  createdAtSecs: number,
  nowSecs: number,
  retentionDays = DATELESS_RETENTION_DAYS,
): boolean {
  if (typeof startTimeMax === "number") return false;
  if (!(DATELESS_SWEEPABLE_STATUSES as readonly string[]).includes(status)) return false;
  return createdAtSecs < nowSecs - retentionDays * 86_400;
}
