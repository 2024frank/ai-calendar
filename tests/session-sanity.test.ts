import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeEvent, validateEvent, type ExtractedEvent } from "../src/lib/contract";

const HOUR = 3600;
const START = 2_000_000_000;

function base(overrides: Partial<ExtractedEvent> = {}): ExtractedEvent {
  return {
    eventType: "ot",
    title: "Ceramic Pumpkins",
    description: "Make a pinch-pot pumpkin in one guided studio session.",
    extendedDescription: null,
    sessions: [{ startTime: START, endTime: START + 2 * HOUR }],
    locationType: "ph2",
    location: "39 S Main St, Oberlin, OH 44074",
    urlLink: null,
    display: "all",
    postTypeId: [89],
    sponsors: ["FAVA Gallery"],
    website: "https://example.test/class",
    registrationUrl: null,
    imageCdnUrl: "https://example.test/pumpkin.jpg",
    contactEmail: "hello@example.test",
    phone: "440-555-0100",
    calendarSourceUrl: "https://example.test/class",
    ...overrides,
  };
}

describe("session normalization", () => {
  it("sorts sessions and drops exact duplicates", () => {
    const e = normalizeEvent({
      eventType: "ot",
      title: "Weekly Class",
      sessions: [
        { start: "2026-10-28T17:00", end: "2026-10-28T19:00" },
        { start: "2026-10-21T17:00", end: "2026-10-21T19:00" },
        { start: "2026-10-21T17:00", end: "2026-10-21T19:00" },
      ],
    });
    assert.equal(e.sessions.length, 2);
    assert.ok(e.sessions[0].startTime < e.sessions[1].startTime);
  });
});

describe("session sanity validation", () => {
  it("accepts an ordinary two-hour session", () => {
    assert.deepEqual(validateEvent(base()), []);
  });

  it("flags two sessions that start at the same instant", () => {
    const issues = validateEvent(base({
      sessions: [
        { startTime: START, endTime: START + 7 * 24 * HOUR + 3 * HOUR },
        { startTime: START, endTime: START + 7 * 24 * HOUR },
      ],
    }));
    assert.ok(issues.includes("sessions_overlap"), issues.join(","));
  });

  it("flags an attended session spanning many days (a window misread as a session)", () => {
    const issues = validateEvent(base({
      sessions: [{ startTime: START, endTime: START + 9 * 24 * HOUR }],
    }));
    assert.ok(issues.includes("session_too_long"), issues.join(","));
  });

  it("does not flag a long announcement display window", () => {
    const issues = validateEvent(base({
      eventType: "an",
      title: "Register for Ceramic Pumpkins",
      sessions: [{ startTime: START, endTime: START + 9 * 24 * HOUR }],
    }));
    assert.ok(!issues.includes("session_too_long"), issues.join(","));
  });

  it("does not flag distinct weekly sessions", () => {
    const issues = validateEvent(base({
      sessions: [
        { startTime: START, endTime: START + 2 * HOUR },
        { startTime: START + 7 * 24 * HOUR, endTime: START + 7 * 24 * HOUR + 2 * HOUR },
      ],
    }));
    assert.deepEqual(issues, []);
  });
});
