import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cronToLabel,
  cronToValue,
  scheduledSourceIsDue,
  valueToCron,
} from "../src/lib/schedule";

const hour = 60 * 60_000;

describe("schedule conversion", () => {
  it("round-trips supported schedules and treats empty schedules as manual", () => {
    assert.equal(valueToCron("daily"), "0 6 * * *");
    assert.equal(valueToCron("weekly"), "0 6 * * 1");
    assert.equal(valueToCron("manual"), null);
    assert.equal(valueToCron("unknown"), null);

    assert.equal(cronToValue("0 6,18 * * *"), "daily");
    assert.equal(cronToValue("0 6 * * 1"), "weekly");
    assert.equal(cronToValue(null), "manual");
    assert.equal(cronToValue("15 9 * * 2"), "custom");
  });

  it("describes known and simple custom schedules", () => {
    assert.equal(cronToLabel("0 6 * * 1-5"), "Every weekday");
    assert.equal(cronToLabel("0 6,18 * * *"), "Every day");
    assert.equal(cronToLabel("30 14 * * 2"), "Every Tuesday at 2:30pm");
    assert.equal(cronToLabel("0 9 */4 * *"), "Every 4 days at 9am");
    assert.equal(cronToLabel("not-a-cron"), "Custom schedule");
  });
});

describe("scheduledSourceIsDue", () => {
  const mondayNoonUtc = Date.parse("2026-08-03T12:00:00.000Z");

  it("never schedules manual sources", () => {
    assert.equal(scheduledSourceIsDue(null, null, mondayNoonUtc, "UTC"), false);
    assert.equal(scheduledSourceIsDue(undefined, null, mondayNoonUtc, "UTC"), false);
  });

  it("schedules a source with no valid successful completion history", () => {
    assert.equal(
      scheduledSourceIsDue("0 6 * * *", null, mondayNoonUtc, "UTC"),
      true,
    );
    assert.equal(
      scheduledSourceIsDue("0 6 * * *", "not-a-date", mondayNoonUtc, "UTC"),
      true,
    );
  });

  it("treats legacy twice-daily rows as daily on the once-daily host", () => {
    assert.equal(
      scheduledSourceIsDue(
        "0 6,18 * * *",
        new Date(mondayNoonUtc - 22 * hour + 1),
        mondayNoonUtc,
        "UTC",
      ),
      false,
    );
    assert.equal(
      scheduledSourceIsDue(
        "0 6,18 * * *",
        new Date(mondayNoonUtc - 22 * hour),
        mondayNoonUtc,
        "UTC",
      ),
      true,
    );
  });

  it("uses the supported minimum intervals", () => {
    const cases = [
      ["0 6 * * *", 22],
      ["0 6 */3 * *", 65],
      ["0 6 * * 1", 160],
    ] as const;

    for (const [cron, hours] of cases) {
      assert.equal(
        scheduledSourceIsDue(
          cron,
          new Date(mondayNoonUtc - hours * hour + 1),
          mondayNoonUtc,
          "UTC",
        ),
        false,
        `${cron} should not be due before ${hours} hours`,
      );
      assert.equal(
        scheduledSourceIsDue(
          cron,
          new Date(mondayNoonUtc - hours * hour),
          mondayNoonUtc,
          "UTC",
        ),
        true,
        `${cron} should be due at ${hours} hours`,
      );
    }
  });

  it("does not run weekday schedules on weekends", () => {
    const saturdayNoonUtc = Date.parse("2026-08-01T12:00:00.000Z");
    assert.equal(
      scheduledSourceIsDue("0 6 * * 1-5", null, saturdayNoonUtc, "UTC"),
      false,
    );
    assert.equal(
      scheduledSourceIsDue(
        "0 6 * * 1-5",
        new Date(saturdayNoonUtc - 7 * 24 * hour),
        saturdayNoonUtc,
        "UTC",
      ),
      false,
    );
  });

  it("runs weekly schedules only on Monday in the community timezone", () => {
    const mondayEarlyUtc = Date.parse("2026-08-03T02:00:00.000Z");
    assert.equal(
      scheduledSourceIsDue("0 6 * * 1", null, mondayEarlyUtc, "America/New_York"),
      false,
    );
    assert.equal(
      scheduledSourceIsDue("0 6 * * 1", null, mondayEarlyUtc, "Asia/Tokyo"),
      true,
    );
  });

  it("does not consider future completions due", () => {
    assert.equal(
      scheduledSourceIsDue(
        "0 6 * * *",
        new Date(mondayNoonUtc + hour),
        mondayNoonUtc,
        "UTC",
      ),
      false,
    );
  });
});
