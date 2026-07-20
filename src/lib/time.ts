/**
 * Turning a written date into a real instant.
 *
 * Language models are unreliable at computing Unix timestamps and at date
 * arithmetic (PRIMETIME, arXiv 2504.16155), which is exactly how "Summer Art
 * Camp July 27" became January 27. The fix, and the documented best practice,
 * is to have the model copy the date as an ISO wall-clock string and do the
 * conversion to Unix seconds here, deterministically and timezone-correct.
 */

type Wall = { y: number; mo: number; d: number; h: number; mi: number };

/**
 * Offset in minutes of a named zone at a given instant, DST included. Uses the
 * engine's IANA database via Intl, so it stays correct without a library.
 */
function zoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

/** Parse the many ways a date can be written into wall-clock parts. */
export function parseWall(input: string): Wall | null {
  const s = input.trim();
  if (!s) return null;

  // ISO-ish: 2026-07-27, 2026-07-27T12:30, 2026/07/27 12:30, with optional seconds.
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (iso) {
    return {
      y: +iso[1],
      mo: +iso[2] - 1,
      d: +iso[3],
      h: iso[4] ? +iso[4] : 0,
      mi: iso[5] ? +iso[5] : 0,
    };
  }

  // A bare number is a Unix timestamp (seconds or milliseconds), for anything
  // that still arrives that way.
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    const ms = s.length >= 13 ? n : n * 1000;
    const d = new Date(ms);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
  }

  return null;
}

/**
 * Convert a wall-clock time, understood in `timeZone`, to Unix seconds. The
 * offset is looked up for that specific date so DST is handled; the guess is
 * refined once because the offset can differ across a DST boundary.
 */
export function wallToUnix(wall: Wall, timeZone: string): number {
  const naiveUtc = Date.UTC(wall.y, wall.mo, wall.d, wall.h, wall.mi);
  let offset = zoneOffsetMinutes(naiveUtc, timeZone);
  let real = naiveUtc - offset * 60000;
  const offset2 = zoneOffsetMinutes(real, timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    real = naiveUtc - offset * 60000;
  }
  return Math.floor(real / 1000);
}

/**
 * A date string to Unix seconds in the given zone. When the year is missing the
 * model may have inferred it wrong (another 2025-vs-2026 slip), so `referenceMs`
 * lets the caller pick the nearest sensible year instead. Returns 0 on garbage.
 */
export function toUnixSeconds(input: string, timeZone: string, referenceMs?: number): number {
  const wall = parseWall(input);
  if (!wall) return 0;

  // A bare unix timestamp was already absolute; return it as-is.
  if (/^\d{10,13}$/.test(input.trim())) {
    const n = Number(input.trim());
    return input.trim().length >= 13 ? Math.floor(n / 1000) : n;
  }

  let unix = wallToUnix(wall, timeZone);

  // Backstop for a stale year only: if the model wrote a year BEFORE the current
  // one (the "2025" slip when it is 2026), roll the same month and day forward to
  // the next occurrence that is today or later. A date in the current year or
  // later is trusted as written, so a genuinely-past recent event stays in the
  // past and is filtered normally, never teleported to next year.
  if (referenceMs != null) {
    const refDate = new Date(referenceMs);
    const currentYear = refDate.getUTCFullYear();
    const refSec = Math.floor(referenceMs / 1000);
    const DAY = 86400;
    if (wall.y < currentYear && unix < refSec - DAY) {
      for (let y = currentYear; y <= currentYear + 1; y++) {
        const rolled = wallToUnix({ ...wall, y }, timeZone);
        if (rolled >= refSec - DAY) {
          unix = rolled;
          break;
        }
      }
    }
  }

  return unix;
}
