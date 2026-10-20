import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateEvent, type ExtractedEvent } from "../src/lib/contract";

const START = 2_000_000_000;

function base(overrides: Partial<ExtractedEvent> = {}): ExtractedEvent {
  return {
    eventType: "ot",
    title: "Wind Symphony",
    description: "A youth orchestra concert of wind ensemble works.",
    extendedDescription: null,
    sessions: [{ startTime: START, endTime: START + 7200 }],
    locationType: "ph2",
    location: "77 W College St, Oberlin, OH 44074",
    urlLink: null,
    display: "all",
    postTypeId: [89],
    sponsors: ["Northern Ohio Youth Orchestra"],
    website: "https://example.test/concert",
    registrationUrl: null,
    imageCdnUrl: "https://example.test/concert.jpg",
    contactEmail: "hello@example.test",
    phone: "440-555-0100",
    calendarSourceUrl: "https://example.test/concert",
    ...overrides,
  };
}

describe("attended events need somewhere to attend", () => {
  it("flags an event with no location type at all", () => {
    const issues = validateEvent(base({ locationType: "ne", location: null }));
    assert.ok(issues.includes("event_location_missing"), issues.join(","));
  });

  it("accepts an in-person event with an address", () => {
    assert.deepEqual(validateEvent(base()), []);
  });

  it("accepts an online event with a link and no address", () => {
    const issues = validateEvent(base({
      locationType: "on",
      location: null,
      urlLink: "https://example.test/stream",
    }));
    assert.deepEqual(issues, []);
  });

  it("does not flag an announcement with no venue", () => {
    const issues = validateEvent(base({
      eventType: "an",
      title: "Apply for the Youth Orchestra",
      locationType: "ne",
      location: null,
    }));
    assert.ok(!issues.includes("event_location_missing"), issues.join(","));
  });

  it("does not flag a job posting with no venue", () => {
    const issues = validateEvent(base({
      eventType: "jp",
      title: "Orchestra Manager",
      locationType: "ne",
      location: null,
    }));
    assert.ok(!issues.includes("event_location_missing"), issues.join(","));
  });
});
