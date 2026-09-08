import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildApolloAnnouncements,
  type TrackedRuns,
} from "../src/lib/sources/apolloSegments";
import type { VeeziFilm } from "../src/lib/sources/veezi";

const film = (title: string, code: string, dates: string[]): VeeziFilm => ({
  title,
  code,
  rating: null,
  showtimes: dates.map((date, index) => ({
    date,
    time: "7:00 PM",
    sessionId: `${code}-${index}`,
  })),
});

const tracked = (entries: Array<[string, string, string?]>): TrackedRuns => new Map(
  entries.map(([key, openedOn, endedOn]) => [key, { openedOn, endedOn: endedOn ?? null }]),
);

const summary = (announcements: ReturnType<typeof buildApolloAnnouncements>) =>
  announcements.map((announcement) => ({
    kind: announcement.kind,
    description: announcement.description,
    start: new Date(announcement.startTime * 1_000).toISOString(),
    end: new Date(announcement.endTime * 1_000).toISOString(),
    movies: announcement.movies.map((movie) => movie.title),
  }));

describe("Apollo current and upcoming segmentation", () => {
  it("keeps an adjacent future opening out of the current lineup and preserves sequel digits and film dates", () => {
    const announcements = buildApolloAnnouncements([
      film("The Current 2", "current-2", [
        "Saturday 5, September",
        "Sunday 6, September",
        "Wednesday 9, September",
      ]),
      film("The Next 3", "next-3", [
        "Thursday 10, September",
        "Saturday 12, September",
      ]),
    ], new Date("2026-09-05T16:00:00Z"), tracked([
      ["current-2", "2026-09-01"],
    ]));

    assert.deepEqual(summary(announcements), [
      {
        kind: "showing_now",
        description: "The Current 2: Sep 1 to Sep 9",
        start: "2026-09-06T04:00:00.000Z",
        end: "2026-09-10T03:59:59.000Z",
        movies: ["The Current 2"],
      },
      {
        kind: "coming_soon",
        description: "The Next 3: opens Sep 10",
        start: "2026-09-10T04:00:00.000Z",
        end: "2026-09-11T03:59:59.000Z",
        movies: ["The Next 3"],
      },
    ]);
    assert.deepEqual(
      announcements.map((announcement) => announcement.title),
      ["Now Playing at the Apollo", "Coming Soon to the Apollo"],
    );
  });

  it("keeps a tracked current film current across a closed run date", () => {
    const announcements = buildApolloAnnouncements([
      film("Closed Wednesday", "closed-day", [
        "Sunday 6, September",
        "Wednesday 9, September",
      ]),
    ], new Date("2026-09-05T16:00:00Z"), tracked([
      ["closed-day", "2026-09-03"],
    ]));

    assert.deepEqual(summary(announcements), [{
      kind: "showing_now",
      description: "Closed Wednesday: Sep 3 to Sep 9",
      start: "2026-09-06T04:00:00.000Z",
      end: "2026-09-10T03:59:59.000Z",
      movies: ["Closed Wednesday"],
    }]);
  });

  it("presents only the nearest future opening instead of every distant presale", () => {
    const announcements = buildApolloAnnouncements([
      film("Next Week", "next-week", ["Thursday 10, September"]),
      film("Much Later", "much-later", ["Sunday 20, September"]),
    ], new Date("2026-09-05T16:00:00Z"));

    assert.deepEqual(summary(announcements), [{
      kind: "coming_soon",
      description: "Next Week: opens Sep 10",
      start: "2026-09-10T04:00:00.000Z",
      end: "2026-09-11T03:59:59.000Z",
      movies: ["Next Week"],
    }]);
  });

  it("returns no announcements for an empty schedule", () => {
    assert.deepEqual(buildApolloAnnouncements([], new Date("2026-09-05T16:00:00Z")), []);
  });

  it("classifies adjacent current and future films correctly across a year boundary", () => {
    const announcements = buildApolloAnnouncements([
      film("Winter Run", "winter-run", [
        "Thursday 31, December",
        "Saturday 2, January",
      ]),
      film("New Year 2", "new-year-2", [
        "Sunday 3, January",
        "Tuesday 5, January",
      ]),
    ], new Date("2026-12-31T17:00:00Z"), tracked([
      ["winter-run", "2026-12-28"],
    ]));

    assert.deepEqual(summary(announcements), [
      {
        kind: "showing_now",
        description: "Winter Run: Dec 28 to Jan 2",
        start: "2027-01-01T05:00:00.000Z",
        end: "2027-01-03T04:59:59.000Z",
        movies: ["Winter Run"],
      },
      {
        kind: "coming_soon",
        description: "New Year 2: opens Jan 3",
        start: "2027-01-03T05:00:00.000Z",
        end: "2027-01-04T04:59:59.000Z",
        movies: ["New Year 2"],
      },
    ]);
  });

  it("treats a film from a completed tracked run as a future reopening", () => {
    const announcements = buildApolloAnnouncements([
      film("September Revival", "revival", [
        "Thursday 10, September",
        "Saturday 12, September",
      ]),
    ], new Date("2026-09-05T16:00:00Z"), tracked([
      ["revival", "2026-08-01", "2026-08-10"],
    ]));

    assert.deepEqual(summary(announcements), [{
      kind: "coming_soon",
      description: "September Revival: opens Sep 10",
      start: "2026-09-10T04:00:00.000Z",
      end: "2026-09-11T03:59:59.000Z",
      movies: ["September Revival"],
    }]);
  });

  it("uses the pre-transition offset for midnight on the spring DST change date", () => {
    const announcements = buildApolloAnnouncements([
      film("Spring Opening", "spring", ["Sunday 8, March"]),
    ], new Date("2026-03-07T17:00:00Z"));

    assert.deepEqual(summary(announcements), [{
      kind: "coming_soon",
      description: "Spring Opening: opens Mar 8",
      start: "2026-03-08T05:00:00.000Z",
      end: "2026-03-09T03:59:59.000Z",
      movies: ["Spring Opening"],
    }]);
  });

  it("uses the pre-transition offset for midnight on the fall DST change date", () => {
    const announcements = buildApolloAnnouncements([
      film("Fall Opening", "fall", ["Sunday 1, November"]),
    ], new Date("2026-10-31T16:00:00Z"));

    assert.deepEqual(summary(announcements), [{
      kind: "coming_soon",
      description: "Fall Opening: opens Nov 1",
      start: "2026-11-01T04:00:00.000Z",
      end: "2026-11-02T04:59:59.000Z",
      movies: ["Fall Opening"],
    }]);
  });
});
