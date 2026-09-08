import type { EventValidationOptions } from "./contract";

type SourceIdentity = {
  slug?: string | null;
};

type CommunityIdentity = {
  slug?: string | null;
};

type SourceKindRow = { sourceKind?: string | null };

/**
 * Original organizations first, aggregators last. The team's rule for the
 * college's Localist calendar is that it only fills gaps: take an event from
 * the organization that runs it whenever that organization is a source too.
 */
export function extractionOrder<T extends SourceKindRow>(list: readonly T[]): T[] {
  const rank = (s: T) => (s.sourceKind === "aggregator" ? 1 : 0);
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .map(({ s }) => s);
}

/**
 * Apollo announcements are schedule summaries, not ordinary event prose. Their
 * short descriptions intentionally say things such as "Film: opens Aug 7".
 * Keep this exception tied to the trusted source row and announcement type so
 * a reviewer-editable event field cannot opt another event out of validation.
 *
 * Every announcement keeps dates in its long description. An announcement's
 * sessions are the window it is displayed in, not when anything happens, so
 * the real class dates, registration deadline or show run can only live in
 * the text (decided June 8 and June 29, 2026). Events keep the date-free rule:
 * their sessions carry the schedule.
 */
export function validationOptionsForSource(
  source: SourceIdentity | null | undefined,
  community: CommunityIdentity | null | undefined,
  eventType: string | null | undefined,
): EventValidationOptions {
  return {
    allowDateInDescription:
      community?.slug === "oberlin" &&
      source?.slug === "apollo-theater" &&
      eventType === "an",
    allowDateInExtendedDescription: eventType === "an",
  };
}
