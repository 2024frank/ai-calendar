import type { EventValidationOptions } from "./contract";

type SourceIdentity = {
  slug?: string | null;
};

type CommunityIdentity = {
  slug?: string | null;
};

/**
 * Apollo announcements are schedule summaries, not ordinary event prose. Their
 * short descriptions intentionally say things such as "Film: opens Aug 7".
 * Keep this exception tied to the trusted source row and announcement type so
 * a reviewer-editable event field cannot opt another event out of validation.
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
  };
}
