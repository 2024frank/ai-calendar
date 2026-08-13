import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DATELESS_RETENTION_DAYS,
  isExpiredByAge,
  isExpiredByDate,
} from "../src/lib/retentionPolicy";
import { maxEndTime, type ExtractedEvent } from "../src/lib/contract";

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

const expiredByDate = (startTimeMax: number | null, nowSecs = NOW) =>
  isExpiredByDate(startTimeMax, nowSecs);

const expiredByAge = (
  startTimeMax: number | null,
  status: string,
  createdAtSecs: number,
  nowSecs = NOW,
) => isExpiredByAge(startTimeMax, status, createdAtSecs, nowSecs);

describe("expiry by date", () => {
  it("keeps a run of dates until the last one has finished", () => {
    const event = {
      sessions: [
        { startTime: NOW - 10 * DAY, endTime: NOW - 10 * DAY + 7200 },
        { startTime: NOW + 20 * DAY, endTime: NOW + 20 * DAY + 7200 },
      ],
    } as ExtractedEvent;
    // The Frank Lloyd Wright case: September is over, November is not.
    assert.equal(expiredByDate(maxEndTime(event)), false);
  });

  it("keeps a long exhibition that opened months ago and closes next year", () => {
    const event = {
      sessions: [{ startTime: NOW - 60 * DAY, endTime: NOW + 300 * DAY }],
    } as ExtractedEvent;
    assert.equal(expiredByDate(maxEndTime(event)), false);
  });

  it("claims an event whose every date has passed", () => {
    const event = {
      sessions: [{ startTime: NOW - 3 * DAY, endTime: NOW - 3 * DAY + 7200 }],
    } as ExtractedEvent;
    assert.equal(expiredByDate(maxEndTime(event)), true);
  });

  it("cannot see a dateless row at all, which is why the second pass exists", () => {
    assert.equal(maxEndTime({ sessions: [] } as unknown as ExtractedEvent), null);
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
