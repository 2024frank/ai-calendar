/**
 * How much checking an event from a source gets before the public sees it.
 *
 * Three levels, and the difference between the last two is who does the
 * checking rather than whether any happens:
 *
 *   needs_approval  a person here reads it and approves it, then it goes up
 *   auto_send       skips us entirely and waits in CommunityHub's own queue
 *   auto_publish    skips both queues and is live the moment it arrives
 *
 * Set per source, so a source that has earned it can be loosened without
 * loosening the rest, and defaulted per community for sources that have no
 * setting of their own.
 */

export const REVIEW_MODES = ["needs_approval", "auto_send", "auto_publish"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

/**
 * The two original names, kept readable.
 *
 * The column started as restricted/unrestricted and rows still carry those
 * values. Rather than a rename across a live database, both spellings are
 * accepted on the way in and everything above this line speaks the new names.
 */
const LEGACY: Record<string, ReviewMode> = {
  restricted: "needs_approval",
  unrestricted: "auto_send",
};

export function normalizeMode(raw: string | null | undefined): ReviewMode | null {
  if (!raw) return null;
  if ((REVIEW_MODES as readonly string[]).includes(raw)) return raw as ReviewMode;
  return LEGACY[raw] ?? null;
}

/** What a person is told each level does. */
export const MODE_LABELS: Record<ReviewMode, { name: string; blurb: string }> = {
  needs_approval: {
    name: "Needs approval",
    blurb: "Someone here reads every event and approves it before it goes anywhere.",
  },
  auto_send: {
    name: "Auto-send",
    blurb: "Goes straight to CommunityHub and waits in their queue for their approval.",
  },
  auto_publish: {
    name: "Auto-publish",
    blurb: "Goes straight to CommunityHub and is live immediately, with nobody checking it.",
  },
};

/** True when events from this source never stop here for a person to read. */
export function skipsOurReview(mode: ReviewMode): boolean {
  return mode !== "needs_approval";
}

/**
 * The status an event lands on once it has reached CommunityHub, which records
 * how it got there rather than merely that it arrived.
 */
export function publishedStatus(mode: ReviewMode): "approved" | "submitted" | "published" {
  if (mode === "needs_approval") return "approved"; // a person here said yes
  if (mode === "auto_send") return "submitted"; // waiting on CommunityHub
  return "published"; // live, nobody checked
}
