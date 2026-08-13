import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DATELESS_RETENTION_DAYS,
  isExpiredByAge,
  isExpiredByDate,
  startOfDaySecs,
} from "../src/lib/retentionPolicy";
import { maxStartTime, type ExtractedEvent } from "../src/lib/contract";

/**
 * The expiry rules, exercised as pure decisions.
 *
 * `sweepExpiredEvents` itself issues two DELETEs and needs a database, so what
 * is checked here is the reasoning behind them: which rows each pass is meant
 * to claim, and which it must leave alone. The bug being guarded against is
 * that dateless rows were invisible to the sweep forever, and the query used to
 * verify the sweep shared that blind spot.
 */

const DAY = 86_400;
const NOW = 1_800_000_000;

const expiredByDate = (lastStart: number | null, cutoff = NOW) =>
  isExpiredByDate(lastStart, cutoff);

const expiredByAge = (
  startTimeMax: number | null,
  status: string,
  createdAtSecs: number,
  nowSecs = NOW,
) => isExpiredByAge(startTimeMax, status, createdAtSecs, nowSecs);

describe("expiry by the last date that has begun", () => {
  it("keeps a run of dates until the final one starts", () => {
    const event = {
      sessions: [
        { startTime: NOW - 10 * DAY, endTime: NOW - 10 * DAY + 7200 },
        { startTime: NOW + 20 * DAY, endTime: NOW + 20 * DAY + 7200 },
      ],
    } as ExtractedEvent;
    // The Frank Lloyd Wright case: September has been and gone, November has not.
    assert.equal(expiredByDate(maxStartTime(event)), false);
  });

  it("keeps a weekly programme until its last week begins", () => {
    const sessions = Array.from({ length: 22 }, (_, week) => ({
      startTime: NOW - 4 * DAY + week * 7 * DAY,
      endTime: NOW - 4 * DAY + week * 7 * DAY + 7200,
    }));
    assert.equal(expiredByDate(maxStartTime({ sessions } as ExtractedEvent)), false);
  });

  it("lets an event run its whole day before removing it", () => {
    // 7pm in New York, swept overnight rather than mid-event.
    const evening = Date.parse("2026-08-12T23:00:00Z") / 1000;
    const duringThatEvening = startOfDaySecs(Date.parse("2026-08-12T23:30:00Z"), "America/New_York");
    const theNextNight = startOfDaySecs(Date.parse("2026-08-13T05:30:00Z"), "America/New_York");

    assert.equal(expiredByDate(evening, duringThatEvening), false, "kept while it is happening");
    assert.equal(expiredByDate(evening, theNextNight), true, "gone once its day is over");
  });

  it("removes an event whose only date has already been", () => {
    const event = {
      sessions: [{ startTime: NOW - 3 * DAY, endTime: NOW - 3 * DAY + 7200 }],
    } as ExtractedEvent;
    assert.equal(expiredByDate(maxStartTime(event)), true);
  });

  it("cannot see a dateless row at all, which is why the second pass exists", () => {
    assert.equal(maxStartTime({ sessions: [] } as unknown as ExtractedEvent), null);
    assert.equal(expiredByDate(null), false);
  });
});

describe("expiry by age, for rows that have no date to expire", () => {
  const old = NOW - (DATELESS_RETENTION_DAYS + 1) * DAY;
  const recent = NOW - 3 * DAY;

  it("clears stale leftovers", () => {
    assert.equal(expiredByAge(null, "auto_rejected", old), true);
    assert.equal(expiredByAge(null, "duplicate", old), true);
  });

  it("leaves recent leftovers alone", () => {
    assert.equal(expiredByAge(null, "auto_rejected", recent), false);
    assert.equal(expiredByAge(null, "duplicate", recent), false);
  });

  it("never touches rows a person is still working with, however old", () => {
    for (const status of ["pending", "approved", "submitted", "rejected"]) {
      assert.equal(expiredByAge(null, status, old), false, status);
    }
  });

  it("never touches a row that does have a date, however old it was created", () => {
    assert.equal(expiredByAge(NOW + 30 * DAY, "duplicate", old), false);
  });
});
