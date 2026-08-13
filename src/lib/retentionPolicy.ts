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
 * An event is finished once it has no date still ahead of it: its LATEST
 * session START has passed. Nobody can attend any part of it after that, so
 * keeping it in the queue only gives reviewers work that can no longer matter.
 *
 * A run of several dates therefore survives until its last date begins, and a
 * weekly programme until its final week. A one-off survives the whole day it
 * happens, because the cutoff is the start of the current day rather than the
 * moment itself: an event at seven this evening must not vanish at seven o'one
 * while it is still going on.
 */
export function isExpiredByDate(
  lastStartTime: number | null | undefined,
  startOfTodaySecs: number,
): boolean {
  return typeof lastStartTime === "number" && lastStartTime < startOfTodaySecs;
}

/**
 * Midnight at the top of today, in the community's own timezone. Events belong
 * to the place they happen, so the day they stop being relevant is that place's
 * day, not the server's.
 */
export function startOfDaySecs(nowMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const secondsIntoDay = get("hour") * 3600 + get("minute") * 60 + get("second");
  return Math.floor(nowMs / 1000) - secondsIntoDay;
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
