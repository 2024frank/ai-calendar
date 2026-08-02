const FALLBACK_TIME_ZONE = "America/New_York";

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/** Offset (ms) of an IANA time zone at a specific instant, including DST. */
function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const representedAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return representedAsUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Format a real instant as the wall-clock value expected by datetime-local. */
export function toLocalInput(seconds: number, timeZone: string): string {
  if (!seconds) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(seconds * 1000));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * Convert an IANA-zone wall time into a real instant.
 *
 * The offset must be resolved at the resulting instant, not at the same-looking
 * UTC time. Iterating reaches that fixed point on both sides of a DST change.
 * A nonexistent spring-forward time oscillates between the two offsets; in that
 * case use the later instant, matching the browser convention of moving forward
 * into the first valid wall time.
 */
export function fromLocalInput(value: string, timeZone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return 0;
  const [, year, month, day, hour, minute] = match.map(Number) as unknown as number[];
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const zone = safeTimeZone(timeZone);
  let candidate = wallAsUtc - timeZoneOffsetMs(wallAsUtc, zone);
  const seen = new Set<number>();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const next = wallAsUtc - timeZoneOffsetMs(candidate, zone);
    if (next === candidate) return Math.floor(candidate / 1000);
    if (seen.has(next)) return Math.floor(Math.max(candidate, next) / 1000);
    seen.add(candidate);
    candidate = next;
  }

  return Math.floor(candidate / 1000);
}
