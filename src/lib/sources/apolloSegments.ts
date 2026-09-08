/**
 * Deterministic Apollo announcement segmenter.
 *
 * Takes the films parsed off the Veezi sessions page (see ./veezi.ts) and the
 * current date, and produces the exact "Apollo - Showing Now" / "Apollo - Coming
 * Soon" announcement payloads — no LLM, no hand-reading of HTML, no date math by
 * the model. The agent only adds posters and POSTs.
 *
 * Rules:
 *  - Showing Now windows start at today + 1. A movie that only plays today is
 *    not announced.
 *  - A film is current only when its verified opening is on or before the
 *    community-local run date. Tracking preserves that fact when today is a
 *    closed day and the first visible session is tomorrow.
 *  - Future openings never fold into Showing Now merely because their dates are
 *    adjacent to a current film. The nearest future opening group is Coming Soon;
 *    later presales wait for a later run so they do not flood the review queue.
 *  - Descriptions retain each film's own observed opening and latest visible
 *    date. Coming Soon retains its verified opening date.
 */
import type { VeeziFilm } from './veezi';

export interface ApolloAnnouncement {
  kind: 'showing_now' | 'coming_soon';
  title: string;                 // "Now Playing at the Apollo" | "Coming Soon to the Apollo"
  description: string;           // " · "-joined per-film lines
  startTime: number;             // unix seconds, 00:00:00 America/New_York of window start
  endTime: number;               // unix seconds, 23:59:59 America/New_York of window end
  movies: { title: string; rating: string | null }[]; // for poster lookup
}

interface Day { y: number; mo: number; d: number } // mo 0-11
interface Run { key: string; title: string; rating: string | null; start: Day; end: Day }

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

const dayNum = (x: Day) => Math.floor(Date.UTC(x.y, x.mo, x.d) / 86400000);
const fromNum = (n: number): Day => { const t = new Date(n * 86400000); return { y: t.getUTCFullYear(), mo: t.getUTCMonth(), d: t.getUTCDate() }; };
const fmt = (x: Day) => `${MONTHS[x.mo].slice(0, 3).replace(/^\w/, c => c.toUpperCase())} ${x.d}`;

/** "Tuesday 30, June" → Day. Year inferred from `today` (Veezi shows only
 *  today-forward dates, so any computed past date is next year's). */
export function parseVeeziDay(s: string, today: Day): Day | null {
  const m = s.match(/(\d{1,2})\s*,\s*([A-Za-z]+)/);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = MONTHS.indexOf(m[2].toLowerCase());
  if (mo < 0 || d < 1 || d > 31) return null;
  let day: Day = { y: today.y, mo, d };
  if (dayNum(day) < dayNum(today)) day = { y: today.y + 1, mo, d };
  return day;
}

function etOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(at).find(p => p.type === 'timeZoneName')?.value || 'GMT-5';
  const m = name.match(/GMT([+-]?\d{1,2})(?::?(\d{2}))?/);
  if (!m) return -300;
  const h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  return h * 60 + (h < 0 ? -min : min);
}
function etEpoch(day: Day, endOfDay: boolean): number {
  const [hh, mm, ss] = endOfDay ? [23, 59, 59] : [0, 0, 0];
  const wallClock = Date.UTC(day.y, day.mo, day.d, hh, mm, ss);
  let instant = wallClock;
  for (let attempt = 0; attempt < 3; attempt++) {
    const resolved = wallClock - etOffsetMinutes(new Date(instant)) * 60000;
    if (resolved === instant) break;
    instant = resolved;
  }
  return Math.floor(instant / 1000);
}

function todayInET(now: Date): Day {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t: string) => parseInt(p.find(x => x.type === t)!.value, 10);
  return { y: g('year'), mo: g('month') - 1, d: g('day') };
}

/** Collapse a film's showtimes into a [start, end] run (min/max visible date). */
function toRun(f: VeeziFilm, today: Day): Run | null {
  const days = f.showtimes.map(s => parseVeeziDay(s.date, today)).filter((x): x is Day => !!x);
  if (!days.length) return null;
  const nums = days.map(dayNum).sort((a, b) => a - b);
  return { key: f.code ?? f.title.toLowerCase().trim(), title: f.title, rating: f.rating, start: fromNum(nums[0]), end: fromNum(nums[nums.length - 1]) };
}

/** Real opened/ended dates gathered across runs, keyed by film key. */
export type TrackedRuns = Map<string, { openedOn: string; endedOn: string | null }>;

const isoToDay = (s: string): Day | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null;
};

export function buildApolloAnnouncements(
  films: VeeziFilm[],
  now: Date = new Date(),
  tracked: TrackedRuns = new Map(),
): ApolloAnnouncement[] {
  const today = todayInET(now);
  const T = dayNum(today);
  const allRuns = films.map(f => toRun(f, today)).filter((r): r is Run => !!r);
  const out: ApolloAnnouncement[] = [];
  const openingDay = (run: Run): Day => {
    const recorded = tracked.get(run.key);
    if (!recorded || recorded.endedOn) return run.start;
    return isoToDay(recorded.openedOn) || run.start;
  };

  // ── Showing Now ────────────────────────────────────────────────────────────
  // Start a day ahead, but only include films that had already opened by the
  // community-local run date. Missing showtimes inside that established run are
  // ordinary closed days, not evidence that the film is future-only.
  const showStart = T + 1;
  const showRuns = allRuns.filter(r =>
    dayNum(openingDay(r)) <= T && dayNum(r.end) >= showStart,
  );
  const lastCovered = showRuns.length
    ? Math.max(...showRuns.map(r => dayNum(r.end)))
    : showStart - 1;

  if (lastCovered >= showStart) {
    const cands = showRuns;

    // Current films can only drop from the lineup; future openings are kept out.
    const points = [...new Set([
      showStart,
      ...cands.map(r => dayNum(r.end) + 1),
    ])].filter(p => p >= showStart && p <= lastCovered + 1).sort((a, b) => a - b);

    for (let i = 0; i < points.length - 1; i++) {
      const ws = points[i], we = points[i + 1] - 1;
      if (we < ws || we > lastCovered) continue;
      const lineup = cands
        .filter(r => dayNum(r.end) >= we)
        .sort((a, b) => dayNum(a.end) - dayNum(b.end) || a.title.localeCompare(b.title));
      if (!lineup.length) continue;
      const description = lineup
        .map(r => `${r.title}: ${fmt(openingDay(r))} to ${fmt(r.end)}`)
        .join(' · ');
      out.push({
        kind: 'showing_now', title: 'Now Playing at the Apollo', description,
        startTime: etEpoch(fromNum(ws), false), endTime: etEpoch(fromNum(we), true),
        movies: lineup.map(r => ({ title: r.title, rating: r.rating })),
      });
    }
  }

  // ── Coming Soon ────────────────────────────────────────────────────────────
  // Announce only the nearest verified future opening group. Its display
  // session is the opening day itself; later presales wait for the next run.
  const comingSoon = allRuns.filter(r => dayNum(openingDay(r)) > T);
  if (comingSoon.length) {
    const nextOpening = Math.min(...comingSoon.map(r => dayNum(openingDay(r))));
    const lineup = comingSoon
      .filter(r => dayNum(openingDay(r)) === nextOpening)
      .sort((a, b) => a.title.localeCompare(b.title));
    const displayDay = fromNum(nextOpening);
    out.push({
      kind: 'coming_soon', title: 'Coming Soon to the Apollo',
      description: lineup.map(r => `${r.title}: opens ${fmt(openingDay(r))}`).join(' · '),
      startTime: etEpoch(displayDay, false), endTime: etEpoch(displayDay, true),
      movies: lineup.map(r => ({ title: r.title, rating: r.rating })),
    });
  }

  return out;
}

export interface FilmRun { key: string; title: string; openedOn: string; lastSeenOn: string }

/** Per-film run rows (ISO dates) for disappearance-based end tracking: opened_on
 *  = earliest visible date, last_seen_on = latest visible date this run. When a
 *  film stops appearing, last_seen_on becomes its real end. */
export function filmRunsForTracking(films: VeeziFilm[], now: Date = new Date()): FilmRun[] {
  const today = todayInET(now);
  const iso = (x: Day) => `${x.y}-${String(x.mo + 1).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
  const out: FilmRun[] = [];
  for (const f of films) {
    const nums = f.showtimes.map(s => parseVeeziDay(s.date, today)).filter((x): x is Day => !!x).map(dayNum).sort((a, b) => a - b);
    if (!nums.length) continue;
    out.push({ key: f.code ?? f.title.toLowerCase().trim(), title: f.title, openedOn: iso(fromNum(nums[0])), lastSeenOn: iso(fromNum(nums[nums.length - 1])) });
  }
  return out;
}
