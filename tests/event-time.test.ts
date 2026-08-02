import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fromLocalInput,
  toLocalInput,
} from "../src/app/(app)/review/[id]/eventTime";

describe("event review wall-clock conversion", () => {
  it("round-trips ordinary community-local times", () => {
    for (const timeZone of [
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
    ]) {
      const wallTime = "2026-08-12T19:45";
      assert.equal(toLocalInput(fromLocalInput(wallTime, timeZone), timeZone), wallTime);
    }
  });

  it("uses the post-transition offset after spring-forward", () => {
    const seconds = fromLocalInput("2026-03-08T03:30", "America/New_York");
    assert.equal(seconds, Date.parse("2026-03-08T07:30:00.000Z") / 1000);
    assert.equal(toLocalInput(seconds, "America/New_York"), "2026-03-08T03:30");
  });

  it("moves a nonexistent spring-forward wall time into the valid hour", () => {
    const seconds = fromLocalInput("2026-03-08T02:30", "America/New_York");
    assert.equal(toLocalInput(seconds, "America/New_York"), "2026-03-08T03:30");
  });

  it("chooses the earlier occurrence of an ambiguous fall-back time", () => {
    const seconds = fromLocalInput("2026-11-01T01:30", "America/New_York");
    assert.equal(seconds, Date.parse("2026-11-01T05:30:00.000Z") / 1000);
    assert.equal(toLocalInput(seconds, "America/New_York"), "2026-11-01T01:30");
  });

  it("rejects malformed values", () => {
    assert.equal(fromLocalInput("", "America/New_York"), 0);
    assert.equal(fromLocalInput("2026/08/12 19:45", "America/New_York"), 0);
  });
});
