import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isValidTimeZone, toUnixSeconds } from "../src/lib/time";

describe("event source wall-clock validation", () => {
  it("accepts real calendar dates, including leap day", () => {
    assert.equal(
      toUnixSeconds("2028-02-29T12:30", "America/New_York"),
      Date.parse("2028-02-29T17:30:00.000Z") / 1000,
    );
  });

  it("rejects rolled calendar dates and invalid clock values", () => {
    for (const value of [
      "2026-02-29T12:30",
      "2026-02-30T12:30",
      "2026-13-01T12:30",
      "2026-08-01T24:00",
      "2026-08-01T12:60",
      "2026-08-01T12:30 unexpected text",
    ]) {
      assert.equal(toUnixSeconds(value, "America/New_York"), 0, value);
    }
  });

  it("recognizes valid IANA timezones", () => {
    assert.equal(isValidTimeZone("America/New_York"), true);
    assert.equal(isValidTimeZone("not/a-zone"), false);
  });
});
