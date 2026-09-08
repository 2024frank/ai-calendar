import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  apolloAnnouncementExtends,
  apolloAnnouncementsMatch,
  isApolloSource,
  type ApolloAnnouncementLike,
} from "../src/lib/apolloDuplicatePolicy";

const at = (iso: string) => Math.floor(Date.parse(iso) / 1_000);
const window = (start: string, end: string) => [{ startTime: at(start), endTime: at(end) }];

const playing = (
  description: string | null,
  sessions: unknown = window("2026-09-01T04:00:00Z", "2026-09-11T03:59:59Z"),
  title = "Playing Now at the Apollo",
): ApolloAnnouncementLike => ({ eventType: "an", title, description, sessions });

describe("Apollo source identity", () => {
  it("matches only the canonical community and source slugs", () => {
    assert.equal(isApolloSource({ slug: "apollo-theater" }, { slug: "oberlin" }), true);
    assert.equal(isApolloSource({ slug: "Apollo-Theater" }, { slug: "oberlin" }), false);
    assert.equal(isApolloSource({ slug: "apollo-theater" }, { slug: "another-community" }), false);
    assert.equal(isApolloSource({ slug: "another-source" }, { slug: "oberlin" }), false);
    assert.equal(isApolloSource(null, { slug: "oberlin" }), false);
    assert.equal(isApolloSource({ slug: "apollo-theater" }, undefined), false);
  });
});

describe("Apollo rolling-window extension", () => {
  const yesterday = playing(
    "Dog Stars: Sep 1 to Sep 9 . Coyote vs. Acme: Sep 1 to Sep 9",
    window("2026-09-07T04:00:00Z", "2026-09-10T03:59:59Z"),
  );

  it("extends when a film's visible end moved later and nothing else changed", () => {
    const today = playing(
      "The Dog Stars: Sep 1 to Sep 9 . Coyote vs. Acme: Sep 1 to Sep 17",
      window("2026-09-08T04:00:00Z", "2026-09-10T03:59:59Z"),
      "Now Playing at the Apollo",
    );
    const result = apolloAnnouncementExtends({ ...today, description: "Dog Stars: Sep 1 to Sep 9 . Coyote vs. Acme: Sep 1 to Sep 17" }, yesterday);
    assert.equal(result.extends, true);
    assert.match(result.reason, /end date moved later/);
  });

  it("extends when only the display window reaches later within the same film runs", () => {
    const earlierWindow = playing(
      "Dog Stars: Sep 1 to Sep 9 . Coyote vs. Acme: Sep 1 to Sep 9",
      window("2026-09-06T04:00:00Z", "2026-09-08T03:59:59Z"),
    );
    const result = apolloAnnouncementExtends(
      playing("Dog Stars: Sep 1 to Sep 9 . Coyote vs. Acme: Sep 1 to Sep 9", window("2026-09-08T04:00:00Z", "2026-09-10T03:59:59Z")),
      earlierWindow,
    );
    assert.equal(result.extends, true);
    assert.match(result.reason, /display window reaches later/);
  });

  it("does not extend across a changed lineup, a different opening, an earlier end, or an earlier window", () => {
    assert.equal(apolloAnnouncementExtends(playing("Coyote vs. Acme: Sep 1 to Sep 17", window("2026-09-10T04:00:00Z", "2026-09-18T03:59:59Z")), yesterday).extends, false);
    assert.equal(apolloAnnouncementExtends(playing("Dog Stars: Sep 2 to Sep 9 . Coyote vs. Acme: Sep 1 to Sep 17", window("2026-09-08T04:00:00Z", "2026-09-10T03:59:59Z")), yesterday).extends, false);
    assert.equal(apolloAnnouncementExtends(playing("Dog Stars: Sep 1 to Sep 8 . Coyote vs. Acme: Sep 1 to Sep 17", window("2026-09-08T04:00:00Z", "2026-09-09T03:59:59Z")), yesterday).extends, false);
    assert.equal(apolloAnnouncementExtends(playing("Dog Stars: Sep 1 to Sep 9 . Coyote vs. Acme: Sep 1 to Sep 17", window("2026-09-05T04:00:00Z", "2026-09-10T03:59:59Z")), yesterday).extends, false);
    assert.equal(apolloAnnouncementExtends(playing("Dog Stars: opens Sep 1", window("2026-09-08T04:00:00Z", "2026-09-10T03:59:59Z"), "Coming Soon to the Apollo"), yesterday).extends, false);
  });

  it("is not an extension when the existing record already covers everything", () => {
    assert.equal(apolloAnnouncementExtends(
      playing("Dog Stars: Sep 1 to Sep 9 . Coyote vs. Acme: Sep 1 to Sep 9", window("2026-09-08T04:00:00Z", "2026-09-10T03:59:59Z")),
      yesterday,
    ).extends, false);
  });
});

describe("Apollo announcement duplicate policy", () => {
  it("matches a reordered lineup when the later display window is covered", () => {
    const existing = playing(
      "Coyote vs. Acme: Sep 1 to Sep 10 · Spider-Man: Brand New Day: September 1 to September 10",
    );
    const candidate = playing(
      "Spider-Man: Brand New Day: Sep 1 to Sep 10 . Coyote vs. Acme: September 1 to September 10",
      window("2026-09-05T04:00:00Z", "2026-09-11T03:59:59Z"),
      "Now Playing at Apollo",
    );

    assert.deepEqual(apolloAnnouncementsMatch(candidate, existing), {
      match: true,
      reason: "same Apollo announcement lineup and covered display window",
    });
  });

  it("matches a yearless single-day film range against the same announcement", () => {
    const announcement = playing(
      "Spider-Man: Brand New Day: Sep 10 to Sep 10",
      window("2026-09-10T04:00:00Z", "2026-09-11T03:59:59Z"),
    );

    assert.equal(apolloAnnouncementsMatch(announcement, announcement).match, true);
  });

  it("matches a yearless two-day film range against the same announcement", () => {
    const announcement = playing(
      "Dog Stars: Sep 10 to Sep 11",
      window("2026-09-10T04:00:00Z", "2026-09-12T03:59:59Z"),
    );

    assert.equal(apolloAnnouncementsMatch(announcement, announcement).match, true);
  });

  it("infers consecutive years for a short December-to-January film range", () => {
    const announcement = playing(
      "Dog Stars: Dec 31 to Jan 1",
      window("2026-12-31T05:00:00Z", "2027-01-02T04:59:59Z"),
    );

    assert.equal(apolloAnnouncementsMatch(announcement, announcement).match, true);
    assert.equal(apolloAnnouncementsMatch({
      ...announcement,
      description: "Dog Stars: 2026-12-31 to 2027-01-01",
    }, announcement).match, true);
  });

  it("does not stretch a yearless short range across unrelated seasons", () => {
    const announcement = playing(
      "Dog Stars: Sep 10 to Sep 11",
      window("2026-01-10T05:00:00Z", "2026-01-11T04:59:59Z"),
    );

    assert.equal(apolloAnnouncementsMatch(announcement, announcement).match, false);
  });

  it("anchors an implicit endpoint to the explicit endpoint's year", () => {
    const announcement = playing(
      "Dog Stars: Dec 31 to Jan 1",
      window("2026-12-31T05:00:00Z", "2027-01-02T04:59:59Z"),
    );
    for (const description of [
      "Dog Stars: 2026-12-31 to Jan 1",
      "Dog Stars: Dec 31 to 2027-01-01",
    ]) {
      assert.equal(apolloAnnouncementsMatch({ ...announcement, description }, announcement).match, true);
    }
    for (const description of [
      "Dog Stars: 2025-12-31 to Jan 1",
      "Dog Stars: Dec 31 to 2028-01-01",
      "Dog Stars: 2025-12-31 to 2026-01-01",
    ]) {
      assert.equal(apolloAnnouncementsMatch({ ...announcement, description }, announcement).match, false);
    }
  });

  it("does not match a different lineup that starts at the same time", () => {
    const existing = playing("Dog Stars: Sep 1 to Sep 10 · Coyote vs. Acme: Sep 1 to Sep 10");
    const candidate = playing("Practical Magic 2: Sep 1 to Sep 10");

    assert.equal(apolloAnnouncementsMatch(candidate, existing).match, false);
  });

  it("does not match a subset lineup in a later rolling week", () => {
    const existing = playing("Dog Stars: Sep 1 to Sep 10 · Coyote vs. Acme: Sep 1 to Sep 10");
    const candidate = playing(
      "Dog Stars: Sep 1 to Sep 10",
      window("2026-09-05T04:00:00Z", "2026-09-11T03:59:59Z"),
    );

    assert.equal(apolloAnnouncementsMatch(candidate, existing).match, false);
  });

  it("does not match the same yearless schedule in a different year", () => {
    const existing = playing("Dog Stars: Sep 1 to Sep 10");
    const candidate = playing(
      "Dog Stars: Sep 1 to Sep 10",
      window("2027-09-01T04:00:00Z", "2027-09-11T03:59:59Z"),
    );

    assert.equal(apolloAnnouncementsMatch(candidate, existing).match, false);
  });

  it("does not match coming soon against playing now", () => {
    const existing = playing("Practical Magic 2: Sep 1 to Sep 10");
    const candidate: ApolloAnnouncementLike = {
      eventType: "an",
      title: "Coming Soon at the Apollo",
      description: "Practical Magic 2: opens Sep 10",
      sessions: window("2026-09-01T04:00:00Z", "2026-09-10T03:59:59Z"),
    };

    assert.equal(apolloAnnouncementsMatch(candidate, existing).match, false);
  });

  it("matches the same coming-soon opening schedule inside a covered display window", () => {
    const existing: ApolloAnnouncementLike = {
      eventType: "an",
      title: "Apollo - Coming Soon",
      description: "Practical Magic 2: opens September 10",
      sessions: window("2026-09-01T04:00:00Z", "2026-09-10T03:59:59Z"),
    };
    const candidate: ApolloAnnouncementLike = {
      ...existing,
      title: "Coming Soon to Apollo",
      description: "Practical Magic 2: opens Sep 10",
      sessions: window("2026-09-05T04:00:00Z", "2026-09-10T03:59:59Z"),
    };

    assert.equal(apolloAnnouncementsMatch(candidate, existing).match, true);
  });

  it("resolves explicit and implicit opening dates on the display session's final day", () => {
    const sessions = window("2026-09-10T04:00:00Z", "2026-09-11T03:59:59Z");
    const implicit: ApolloAnnouncementLike = {
      eventType: "an",
      title: "Coming Soon at the Apollo",
      description: "Practical Magic 2: opens Sep 10",
      sessions,
    };
    const explicit: ApolloAnnouncementLike = {
      ...implicit,
      description: "Practical Magic 2: opens 2026-09-10",
    };

    assert.equal(apolloAnnouncementsMatch(implicit, implicit).match, true);
    assert.equal(apolloAnnouncementsMatch(explicit, implicit).match, true);
  });

  it("does not infer next year for an implicit opening date on the display day", () => {
    const sessions = window("2026-09-10T04:00:00Z", "2026-09-11T03:59:59Z");
    const implicit: ApolloAnnouncementLike = {
      eventType: "an",
      title: "Coming Soon at the Apollo",
      description: "Practical Magic 2: opens Sep 10",
      sessions,
    };
    const wrongYear: ApolloAnnouncementLike = {
      ...implicit,
      description: "Practical Magic 2: opens 2027-09-10",
    };

    assert.equal(apolloAnnouncementsMatch(wrongYear, implicit).match, false);
  });

  it("matches the same open-ended playing schedule", () => {
    const existing = playing("Dog Stars: from Aug 20");
    const candidate = playing(
      "Dog Stars: from August 20",
      window("2026-09-05T04:00:00Z", "2026-09-11T03:59:59Z"),
      "Showing at the Apollo",
    );

    assert.equal(apolloAnnouncementsMatch(candidate, existing).match, true);
  });

  it("keeps sequel digits significant", () => {
    const existing = playing("Practical Magic: Sep 1 to Sep 10");
    const candidate = playing("Practical Magic 2: Sep 1 to Sep 10");

    assert.equal(apolloAnnouncementsMatch(candidate, existing).match, false);
  });

  it("rejects an extended or shortened per-film end date", () => {
    const existing = playing("Dog Stars: 2026-09-01 to 2026-09-10");

    assert.equal(
      apolloAnnouncementsMatch(playing("Dog Stars: 2026-09-01 to 2026-09-11"), existing).match,
      false,
    );
    assert.equal(
      apolloAnnouncementsMatch(playing("Dog Stars: 2026-09-01 to 2026-09-09"), existing).match,
      false,
    );
  });

  it("allows only a later range start inside the existing per-film range", () => {
    const existing = playing("Dog Stars: Sep 1 to Sep 10");
    const candidate = playing(
      "Dog Stars: Sep 5 to Sep 10",
      window("2026-09-05T04:00:00Z", "2026-09-11T03:59:59Z"),
    );

    assert.equal(apolloAnnouncementsMatch(candidate, existing).match, true);
    assert.equal(
      apolloAnnouncementsMatch(playing("Dog Stars: Aug 31 to Sep 10"), existing).match,
      false,
    );
  });

  it("rejects a changed coming-soon opening date", () => {
    const existing: ApolloAnnouncementLike = {
      eventType: "an",
      title: "Coming Soon to the Apollo",
      description: "Practical Magic 2: opens September 10",
      sessions: window("2026-09-01T04:00:00Z", "2026-09-10T03:59:59Z"),
    };
    const candidate = {
      ...existing,
      description: "Practical Magic 2: opens Sep 11",
    };

    assert.equal(apolloAnnouncementsMatch(candidate, existing).match, false);
  });

  it("rejects candidate display dates outside existing coverage", () => {
    const existing = playing("Dog Stars: Sep 1 to Sep 10");
    const candidate = playing(
      "Dog Stars: Sep 1 to Sep 10",
      window("2026-09-01T04:00:00Z", "2026-09-12T03:59:59Z"),
    );

    assert.equal(apolloAnnouncementsMatch(candidate, existing).match, false);
  });

  it("does not bridge a gap between sparse existing display sessions", () => {
    const description = "Dog Stars: Sep 1 to Sep 10";
    const existing = playing(description, [
      ...window("2026-09-01T04:00:00Z", "2026-09-04T03:59:59Z"),
      ...window("2026-09-07T04:00:00Z", "2026-09-11T03:59:59Z"),
    ]);
    const candidate = playing(
      description,
      window("2026-09-03T04:00:00Z", "2026-09-09T03:59:59Z"),
    );

    assert.equal(apolloAnnouncementsMatch(candidate, existing).match, false);
  });

  it("requires announcement type, description, recognized title, and valid sessions", () => {
    const complete = playing("Dog Stars: Sep 1 to Sep 10");
    const invalid: ApolloAnnouncementLike[] = [
      { ...complete, eventType: "event" },
      { ...complete, description: null },
      { ...complete, title: "Apollo Theater" },
      { ...complete, sessions: [] },
      { ...complete, sessions: [{ startTime: 1 }] },
    ];

    for (const candidate of invalid) {
      assert.equal(apolloAnnouncementsMatch(candidate, complete).match, false);
    }
    assert.equal(apolloAnnouncementsMatch(complete, { ...complete, description: null }).match, false);
  });

  it("fails closed without throwing for epoch seconds outside the Date range", () => {
    const invalid = playing("Dog Stars: Sep 1 to Sep 10", [
      { startTime: Number.MAX_SAFE_INTEGER - 1, endTime: Number.MAX_SAFE_INTEGER },
    ]);

    assert.doesNotThrow(() => apolloAnnouncementsMatch(invalid, invalid));
    assert.equal(apolloAnnouncementsMatch(invalid, invalid).match, false);
  });

  it("rejects display sessions spanning multiple years before schedule parsing", () => {
    const broad: ApolloAnnouncementLike = {
      eventType: "an",
      title: "Coming Soon at the Apollo",
      description: "Dog Stars: opens 2030-01-02",
      sessions: window("2020-01-01T05:00:00Z", "2030-01-02T04:59:59Z"),
    };

    assert.equal(apolloAnnouncementsMatch(broad, broad).match, false);
  });

  it("rejects malformed or ambiguous schedule prose", () => {
    const existing = playing("Dog Stars: Sep 1 to Sep 10");
    for (const description of [
      "Dog Stars Sep 1 to Sep 10",
      "Dog Stars: sometime in September",
      "Dog Stars: Sep 1 to Sep 10 ·",
      "Dog Stars: Sep 31 to Oct 2",
    ]) {
      assert.equal(apolloAnnouncementsMatch(playing(description), existing).match, false);
    }
  });
});
