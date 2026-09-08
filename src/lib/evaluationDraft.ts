import type { EvaluationInput, EvaluationRow } from "./evaluation";

/**
 * The research record John asked for on July 16, 2026: what the importer found
 * that the organization never posted, what the organization posted that the
 * importer missed, and how matched pairs differ. The organization's own
 * CommunityHub posts are the reference; our records are the extraction. This
 * only proposes pairs. A person confirms them before anything is retained.
 */

export type HubPostLike = {
  title: string;
  startTimes: number[];
  sessions: { startTime: number; endTime: number }[];
  location: string | null;
  url: string | null;
  sponsors?: string[];
  ingestedPostUrl?: string | null;
};

export type OurEventLike = {
  id: number;
  title: string | null;
  status: string;
  sessions: unknown;
  location: string | null;
  calendarSourceUrl: string | null;
  website: string | null;
};

export type DraftContext = {
  sourceId: number;
  sourceName: string;
  /** Names the organization posts under on CommunityHub. */
  organizationNames: string[];
  period: { start: Date; end: Date };
  capturedAt: Date;
  inventoryAvailable: boolean;
};

export type EvaluationDraft = Omit<EvaluationInput, "scope" | "humanConfirmedMatches"> & {
  scope: Omit<EvaluationInput["scope"], "confirmed"> & { confirmed: boolean };
  humanConfirmedMatches: boolean;
  notes: string[];
};

const MAX_ROWS = 500;
const SAME_OCCURRENCE_WINDOW_S = 36 * 3600;

function normalizedName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    // "L.E.G.O." is one word, not four letters.
    .replace(/([\p{L}\p{N}])\.(?![\p{L}\p{N}]{2})/gu, "$1")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function words(value: string | null | undefined): Set<string> {
  return new Set(normalizedName(value).split(" ").filter((w) => w.length > 2));
}

/** Word overlap between two titles, 0 to 1. Cheap on purpose: a person confirms. */
export function titleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  const na = normalizedName(a);
  const nb = normalizedName(b);
  if (na === nb || (na.length >= 4 && nb.includes(na)) || (nb.length >= 4 && na.includes(nb))) return 1;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / Math.min(wa.size, wb.size);
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

function inPeriod(seconds: number, period: DraftContext["period"]): boolean {
  const ms = seconds * 1000;
  return ms >= period.start.getTime() && ms < period.end.getTime();
}

function firstSession(sessions: unknown): { start: number; end: number | null } | null {
  if (!Array.isArray(sessions)) return null;
  const starts = sessions
    .map((s) => ({ start: Number((s as { startTime?: unknown })?.startTime), end: Number((s as { endTime?: unknown })?.endTime) }))
    .filter((s) => Number.isFinite(s.start) && s.start > 0)
    .sort((a, b) => a.start - b.start);
  if (!starts.length) return null;
  return { start: starts[0].start, end: Number.isFinite(starts[0].end) && starts[0].end >= starts[0].start ? starts[0].end : null };
}

/** Posts the organization submitted itself: under its own name, not sent by us. */
export function organizationPosts(posts: readonly HubPostLike[], organizationNames: readonly string[]): HubPostLike[] {
  const wanted = new Set(organizationNames.map(normalizedName).filter(Boolean));
  if (!wanted.size) return [];
  return posts.filter((post) => {
    if (post.ingestedPostUrl) return false;
    return (post.sponsors ?? []).some((name) => wanted.has(normalizedName(name)));
  });
}

export function buildEvaluationDraft(
  context: DraftContext,
  hubPosts: readonly HubPostLike[],
  ourEvents: readonly OurEventLike[],
): EvaluationDraft {
  const notes: string[] = [];
  const reference: EvaluationRow[] = [];
  for (const post of organizationPosts(hubPosts, context.organizationNames)) {
    const start = post.sessions.length ? Math.min(...post.sessions.map((s) => s.startTime)) : post.startTimes.length ? Math.min(...post.startTimes) : null;
    if (start === null || !inPeriod(start, context.period)) continue;
    const session = post.sessions.find((s) => s.startTime === start);
    const id = post.url ? `hub-${post.url.split("/").filter(Boolean).pop()}` : `hub-${reference.length + 1}`;
    reference.push({ id, title: post.title, startTime: iso(start), endTime: session ? iso(session.endTime) : null, location: post.location, url: post.url });
  }

  const extracted: EvaluationRow[] = [];
  for (const event of ourEvents) {
    if (event.status === "duplicate") continue;
    const session = firstSession(event.sessions);
    if (!session || !inPeriod(session.start, context.period)) continue;
    extracted.push({
      id: `ai-${event.id}-${event.status}`,
      title: event.title || "Untitled",
      startTime: iso(session.start),
      endTime: session.end === null ? null : iso(session.end),
      location: event.location,
      url: event.calendarSourceUrl ?? event.website ?? null,
    });
  }

  if (reference.length > MAX_ROWS || extracted.length > MAX_ROWS) {
    notes.push(`Only the first ${MAX_ROWS} rows on each side are kept; narrow the period.`);
    reference.splice(MAX_ROWS);
    extracted.splice(MAX_ROWS);
  }

  // Propose one-to-one pairs: same occurrence within a day and a half, best
  // title overlap first. These are suggestions for a person to check.
  const candidates: { referenceId: string; extractedId: string; score: number }[] = [];
  for (const ref of reference) {
    for (const ext of extracted) {
      const gap = Math.abs(Date.parse(ref.startTime) - Date.parse(ext.startTime)) / 1000;
      if (gap > SAME_OCCURRENCE_WINDOW_S) continue;
      const score = titleSimilarity(ref.title, ext.title);
      if (score >= 0.5) candidates.push({ referenceId: ref.id, extractedId: ext.id, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.referenceId.localeCompare(b.referenceId));
  const usedRef = new Set<string>();
  const usedExt = new Set<string>();
  const matches: { referenceId: string; extractedId: string }[] = [];
  for (const c of candidates) {
    if (usedRef.has(c.referenceId) || usedExt.has(c.extractedId)) continue;
    usedRef.add(c.referenceId);
    usedExt.add(c.extractedId);
    matches.push({ referenceId: c.referenceId, extractedId: c.extractedId });
  }

  if (!context.inventoryAvailable) notes.push("CommunityHub could not be read; the reference side is empty, not proven empty.");
  if (!context.organizationNames.length) notes.push("This source has no organization name to look for on CommunityHub.");
  notes.push("Matches are proposals from title and date overlap. Check each one, then set humanConfirmedMatches and scope.confirmed to true.");

  const capturedAt = context.capturedAt.toISOString();
  return {
    version: 1,
    sourceId: context.sourceId,
    title: `${context.sourceName}: importer vs. direct CommunityHub posts, ${context.period.start.toISOString().slice(0, 10)} to ${context.period.end.toISOString().slice(0, 10)}`,
    period: { start: context.period.start.toISOString(), end: context.period.end.toISOString() },
    scope: {
      description: `Posts on CommunityHub sponsored by ${context.organizationNames.join(" / ") || context.sourceName} and not sent by the importer, against every non-duplicate record the importer holds for this source. Period includes start, excludes end.`,
      referenceCompleteness: context.inventoryAvailable ? "partial" : "unknown",
      confirmed: false,
    },
    provenance: {
      reference: { description: "CommunityHub upcoming-posts listing read by the importer's own inventory fetch, filtered to the organization's direct submissions", capturedAt, independent: true },
      extracted: { description: "Importer event records for this source, all statuses except duplicate", capturedAt },
    },
    reference,
    extracted,
    matches,
    humanConfirmedMatches: false,
    notes,
  };
}
