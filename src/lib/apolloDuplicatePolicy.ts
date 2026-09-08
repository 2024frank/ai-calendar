export interface ApolloAnnouncementLike {
  eventType?: string | null;
  title?: string | null;
  description?: string | null;
  sessions?: unknown;
}

type SourceIdentity = { slug?: string | null };
type CommunityIdentity = { slug?: string | null };
type AnnouncementKind = "playing" | "coming";
type SessionWindow = { start: number; end: number };
type ParsedDate = { year: number | null; month: number; day: number };
type Schedule =
  | { kind: "range"; start: number; end: number }
  | { kind: "from"; start: number }
  | { kind: "opens"; start: number };

const DAY_MS = 86_400_000;
const MAX_SCHEDULE_DISTANCE_DAYS = 370;
const MAX_SCHEDULE_SPAN_DAYS = 366;
const MAX_DISPLAY_SPAN_SECONDS = 370 * 86_400;

const MONTHS = new Map<string, number>([
  ["jan", 1], ["january", 1],
  ["feb", 2], ["february", 2],
  ["mar", 3], ["march", 3],
  ["apr", 4], ["april", 4],
  ["may", 5],
  ["jun", 6], ["june", 6],
  ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8],
  ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10],
  ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12],
]);

const MONTH_TOKEN = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const DATE_TOKEN = `(?:\\d{4}-\\d{2}-\\d{2}|${MONTH_TOKEN}\\s+\\d{1,2}(?:,?\\s+\\d{4})?)`;
const SCHEDULE_RE = new RegExp(
  `^(.*):\\s*(?:(opens|from)\\s+)?(${DATE_TOKEN})(?:\\s+to\\s+(${DATE_TOKEN}))?$`,
  "i",
);

const DISPLAY_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function isApolloSource(
  source: SourceIdentity | null | undefined,
  community: CommunityIdentity | null | undefined,
): boolean {
  return source?.slug === "apollo-theater" && community?.slug === "oberlin";
}

function normalizedWords(value: string): string {
  return (value.normalize("NFKC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
}

function announcementKind(title: string): AnnouncementKind | null {
  const words = normalizedWords(title);
  const playing = new Set([
    "playing now at apollo",
    "playing now at the apollo",
    "showing now at apollo",
    "showing now at the apollo",
    "now playing at apollo",
    "now playing at the apollo",
    "playing at apollo",
    "playing at the apollo",
    "showing at apollo",
    "showing at the apollo",
    "apollo playing now",
    "apollo showing now",
    "apollo now playing",
    "apollo theater playing now",
    "apollo theater showing now",
    "apollo theater now playing",
  ]);
  if (playing.has(words)) return "playing";

  const coming = new Set([
    "coming soon at apollo",
    "coming soon at the apollo",
    "coming soon to apollo",
    "coming soon to the apollo",
    "apollo coming soon",
    "apollo theater coming soon",
  ]);
  return coming.has(words) ? "coming" : null;
}

function sessionsOf(value: unknown): SessionWindow[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const sessions: SessionWindow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const start = (raw as { startTime?: unknown }).startTime;
    const end = (raw as { endTime?: unknown }).endTime;
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start <= 0 ||
      end < start ||
      !Number.isFinite(new Date(start * 1_000).getTime()) ||
      !Number.isFinite(new Date(end * 1_000).getTime())
    ) return null;
    sessions.push({ start, end });
  }
  sessions.sort((a, b) => a.start - b.start || a.end - b.end);
  const firstStart = sessions[0].start;
  let lastEnd = sessions[0].end;
  for (const session of sessions) lastEnd = Math.max(lastEnd, session.end);
  return lastEnd - firstStart <= MAX_DISPLAY_SPAN_SECONDS ? sessions : null;
}

function mergedCoverage(sessions: SessionWindow[]): SessionWindow[] {
  const merged: SessionWindow[] = [];
  for (const session of sessions) {
    const last = merged.at(-1);
    if (!last || session.start > last.end + 1) {
      merged.push({ ...session });
    } else {
      last.end = Math.max(last.end, session.end);
    }
  }
  return merged;
}

function sessionsCovered(candidate: SessionWindow[], existing: SessionWindow[]): boolean {
  const coverage = mergedCoverage(existing);
  return candidate.every((session) =>
    coverage.some((window) => window.start <= session.start && window.end >= session.end),
  );
}

function validDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function parseDate(value: string): ParsedDate | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return validDay(year, month, day) ? { year, month, day } : null;
  }

  const named = new RegExp(`^(${MONTH_TOKEN})\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?$`, "i").exec(value);
  if (!named) return null;
  const monthName = named[1].replace(/\.$/, "").toLowerCase();
  const month = MONTHS.get(monthName);
  const day = Number(named[2]);
  const year = named[3] ? Number(named[3]) : null;
  if (!month || day < 1 || day > 31) return null;
  if (year !== null && !validDay(year, month, day)) return null;
  return { year, month, day };
}

function localDay(epochSeconds: number): { number: number; year: number } {
  const parts = DISPLAY_DATE.formatToParts(new Date(epochSeconds * 1_000));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const year = value("year");
  return { number: dayNumber(year, value("month"), value("day")), year };
}

function sessionDayRange(sessions: SessionWindow[]): { start: number; end: number; minYear: number; maxYear: number } {
  const starts = sessions.map((session) => localDay(session.start));
  const ends = sessions.map((session) => localDay(session.end));
  return {
    start: Math.min(...starts.map((date) => date.number)),
    end: Math.max(...ends.map((date) => date.number)),
    minYear: Math.min(...starts.map((date) => date.year), ...ends.map((date) => date.year)),
    maxYear: Math.max(...starts.map((date) => date.year), ...ends.map((date) => date.year)),
  };
}

function dateCandidates(date: ParsedDate, minYear: number, maxYear: number): number[] {
  const firstYear = date.year ?? minYear - 1;
  const lastYear = date.year ?? maxYear + 1;
  const out: number[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    if (validDay(year, date.month, date.day)) out.push(dayNumber(year, date.month, date.day));
  }
  return out;
}

function intervalDistance(start: number, end: number, rangeStart: number, rangeEnd: number): number {
  if (end < rangeStart) return rangeStart - end;
  if (start > rangeEnd) return start - rangeEnd;
  return 0;
}

function uniquelyNearest(values: number[], rangeStart: number, rangeEnd: number): number | null {
  const ranked = values
    .map((value) => ({ value, distance: intervalDistance(value, value, rangeStart, rangeEnd) }))
    .filter(({ distance }) => distance <= MAX_SCHEDULE_DISTANCE_DAYS)
    .sort((a, b) => a.distance - b.distance || a.value - b.value);
  if (!ranked.length || (ranked[1] && ranked[1].distance === ranked[0].distance)) return null;
  return ranked[0].value;
}

function resolveRange(
  start: ParsedDate,
  end: ParsedDate,
  range: ReturnType<typeof sessionDayRange>,
): { start: number; end: number } | null {
  const choices: { start: number; end: number; distance: number }[] = [];
  const inferredYearDelta = end.month < start.month ||
    (end.month === start.month && end.day < start.day) ? 1 : 0;
  for (const startDay of dateCandidates(start, range.minYear, range.maxYear)) {
    for (const endDay of dateCandidates(end, range.minYear, range.maxYear)) {
      if (start.year === null || end.year === null) {
        // Infer the endpoints together: Sep 10 to Sep 11 stays in one year;
        // Dec 31 to Jan 1 crosses exactly one year. Independent inference can
        // invent a year-long range just to cover an unrelated display season.
        const startYear = new Date(startDay * DAY_MS).getUTCFullYear();
        const endYear = new Date(endDay * DAY_MS).getUTCFullYear();
        if (endYear - startYear !== inferredYearDelta) continue;
      }
      if (endDay < startDay || endDay - startDay > MAX_SCHEDULE_SPAN_DAYS) continue;
      if (startDay > range.start || endDay < range.end) continue;
      const distance = intervalDistance(startDay, endDay, range.start, range.end);
      if (distance <= MAX_SCHEDULE_DISTANCE_DAYS) choices.push({ start: startDay, end: endDay, distance });
    }
  }
  choices.sort((a, b) => a.distance - b.distance || a.start - b.start || a.end - b.end);
  if (!choices.length || (choices[1] && choices[1].distance === choices[0].distance)) return null;
  return choices[0];
}

function parseSchedules(
  description: string,
  sessions: SessionWindow[],
  announcement: AnnouncementKind,
): Map<string, Schedule> | null {
  const text = description.trim();
  if (!text) return null;
  const segments = text.split(/\s*[·•]\s*|\s+\.\s+|\s*\n+\s*/);
  if (!segments.length || segments.some((segment) => !segment.trim())) return null;

  const range = sessionDayRange(sessions);
  const schedules = new Map<string, Schedule>();
  for (const segment of segments) {
    const match = SCHEDULE_RE.exec(segment.trim());
    if (!match) return null;
    const film = normalizedWords(match[1]);
    if (!film || schedules.has(film)) return null;

    const verb = match[2]?.toLowerCase() ?? null;
    const startDate = parseDate(match[3]);
    const endDate = match[4] ? parseDate(match[4]) : null;
    if (!startDate || (match[4] && !endDate)) return null;

    if (announcement === "coming") {
      if (verb !== "opens" || endDate) return null;
      const start = uniquelyNearest(
        dateCandidates(startDate, range.minYear, range.maxYear).filter((day) => day >= range.end),
        range.start,
        range.end,
      );
      if (start === null) return null;
      schedules.set(film, { kind: "opens", start });
      continue;
    }

    if (verb === "from" && !endDate) {
      const start = uniquelyNearest(
        dateCandidates(startDate, range.minYear, range.maxYear).filter((day) => day <= range.start),
        range.start,
        range.end,
      );
      if (start === null) return null;
      schedules.set(film, { kind: "from", start });
      continue;
    }
    if (verb || !endDate) return null;
    const resolved = resolveRange(startDate, endDate, range);
    if (!resolved) return null;
    schedules.set(film, { kind: "range", ...resolved });
  }
  return schedules;
}

function schedulesMatch(candidate: Schedule, existing: Schedule): boolean {
  if (candidate.kind !== existing.kind) return false;
  if (candidate.kind === "range" && existing.kind === "range") {
    return candidate.end === existing.end && candidate.start >= existing.start && candidate.start <= existing.end;
  }
  return candidate.start === existing.start;
}

function noMatch(reason: string): { match: false; reason: string } {
  return { match: false, reason };
}

/**
 * The Veezi page shows about twelve days, so a film's visible end date moves
 * later every day while the lineup itself has not changed. A candidate
 * extends an existing Now Playing announcement when it names the same films
 * with the same openings, no film ends earlier, and something reaches later:
 * a film's end or the display window. Yesterday's record is then carried
 * forward instead of a copy being filed beside it (reviewer request, June 29).
 */
export function apolloAnnouncementExtends(
  candidate: ApolloAnnouncementLike,
  existing: ApolloAnnouncementLike,
): { extends: boolean; reason: string } {
  const no = (reason: string) => ({ extends: false, reason });
  if (candidate.eventType !== "an" || existing.eventType !== "an") return no("both records must be announcements");
  if (typeof candidate.title !== "string" || typeof existing.title !== "string") return no("both records need recognized Apollo titles");
  if (announcementKind(candidate.title) !== "playing" || announcementKind(existing.title) !== "playing") {
    return no("only Now Playing announcements roll forward");
  }
  if (typeof candidate.description !== "string" || typeof existing.description !== "string") {
    return no("both records need complete schedule descriptions");
  }
  const candidateSessions = sessionsOf(candidate.sessions);
  const existingSessions = sessionsOf(existing.sessions);
  if (!candidateSessions || !existingSessions) return no("both records need valid display sessions");
  if (candidateSessions[0].start < existingSessions[0].start) return no("candidate window starts earlier");

  const candidateSchedules = parseSchedules(candidate.description, candidateSessions, "playing");
  const existingSchedules = parseSchedules(existing.description, existingSessions, "playing");
  if (!candidateSchedules || !existingSchedules) return no("schedule descriptions are incomplete or ambiguous");
  if (candidateSchedules.size !== existingSchedules.size) return no("film lineups differ");

  let laterEnd = false;
  for (const [film, schedule] of candidateSchedules) {
    const before = existingSchedules.get(film);
    if (!before || before.kind !== schedule.kind) return no("film lineups differ");
    if (schedule.start !== before.start) return no("a film's opening date differs");
    if (schedule.kind === "range" && before.kind === "range") {
      if (schedule.end < before.end) return no("a film now ends earlier");
      if (schedule.end > before.end) laterEnd = true;
    }
  }
  const windowExtends = !sessionsCovered(candidateSessions, existingSessions);
  if (!laterEnd && !windowExtends) return no("nothing reaches later than the existing announcement");
  return {
    extends: true,
    reason: laterEnd
      ? "same lineup and openings; a film's visible end date moved later"
      : "same lineup and openings; the display window reaches later",
  };
}

export function apolloAnnouncementsMatch(
  candidate: ApolloAnnouncementLike,
  existing: ApolloAnnouncementLike,
): { match: boolean; reason: string } {
  if (candidate.eventType !== "an" || existing.eventType !== "an") {
    return noMatch("both records must be announcements");
  }
  if (typeof candidate.title !== "string" || typeof existing.title !== "string") {
    return noMatch("both records need recognized Apollo titles");
  }
  const candidateKind = announcementKind(candidate.title);
  const existingKind = announcementKind(existing.title);
  if (!candidateKind || !existingKind || candidateKind !== existingKind) {
    return noMatch("Apollo announcement kinds differ or are unrecognized");
  }
  if (typeof candidate.description !== "string" || typeof existing.description !== "string") {
    return noMatch("both records need complete schedule descriptions");
  }
  const candidateSessions = sessionsOf(candidate.sessions);
  const existingSessions = sessionsOf(existing.sessions);
  if (!candidateSessions || !existingSessions) {
    return noMatch("both records need valid display sessions");
  }
  if (!sessionsCovered(candidateSessions, existingSessions)) {
    return noMatch("candidate display sessions are not fully covered");
  }

  const candidateSchedules = parseSchedules(candidate.description, candidateSessions, candidateKind);
  const existingSchedules = parseSchedules(existing.description, existingSessions, existingKind);
  if (!candidateSchedules || !existingSchedules) {
    return noMatch("schedule descriptions are incomplete or ambiguous");
  }
  if (candidateSchedules.size !== existingSchedules.size) {
    return noMatch("film lineups differ");
  }
  for (const [film, schedule] of candidateSchedules) {
    const existingSchedule = existingSchedules.get(film);
    if (!existingSchedule) return noMatch("film lineups differ");
    if (!schedulesMatch(schedule, existingSchedule)) return noMatch("per-film dates differ");
  }

  return {
    match: true,
    reason: "same Apollo announcement lineup and covered display window",
  };
}
