import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalCommunityHubPostUrl,
  canonicalSourceEventUrl,
  sourceEventUrlsOverlap,
  trustedAgentDuplicate,
} from "../src/lib/duplicatePolicy";

describe("agent-reported duplicate policy", () => {
  const knownEvents = new Set([41]);
  const knownRemote = new Set(["https://hub.example.com/calendar/post/1578"]);

  it("trusts only records independently present in the tenant inventories", () => {
    assert.deepEqual(
      trustedAgentDuplicate(
        {
          _agentDuplicateOfId: 41,
          _agentDuplicateOf: "https://hub.example.com/calendar/post/1578/",
        },
        knownEvents,
        knownRemote,
      ),
      { eventId: 41, url: "https://hub.example.com/calendar/post/1578" },
    );
  });

  it("does not let an unverified model marker bypass event validation", () => {
    assert.deepEqual(
      trustedAgentDuplicate(
        {
          _agentDuplicateOfId: 999,
          _agentDuplicateOf: "https://attacker.example/calendar/post/1578",
        },
        knownEvents,
        knownRemote,
      ),
      { eventId: null, url: null },
    );
  });

  it("rejects malformed, credentialed, queried, and non-numeric post links", () => {
    for (const value of [
      "https://hub.example.com/calendar/post/not-an-id",
      "https://hub.example.com/calendar/post/1578?token=secret",
      "https://user:pass@hub.example.com/calendar/post/1578",
      "http://127.0.0.1/calendar/post/1578",
    ]) {
      assert.equal(canonicalCommunityHubPostUrl(value), null, value);
    }
  });
});

describe("source event URL identity", () => {
  it("ignores tracking, fragments, and query parameter ordering", () => {
    assert.equal(
      canonicalSourceEventUrl("https://tickets.example.com/event?id=42&lang=en&utm_source=email#tickets"),
      canonicalSourceEventUrl("https://tickets.example.com/event?lang=en&id=42"),
    );
    assert.notEqual(canonicalSourceEventUrl("https://tickets.example.com/event?id=42"), null);
  });

  it("recognizes the same event despite query parameter ordering", () => {
    assert.equal(sourceEventUrlsOverlap(
      { website: "https://tickets.example.com/shows/detail?id=42&lang=en" },
      { calendarSourceUrl: "https://tickets.example.com/shows/detail?lang=en&id=42" },
    ), true);
  });

  it("does not use a generic homepage or listing as event identity", () => {
    for (const url of ["https://example.com/", "https://example.com/events", "https://example.com/upcoming-events"]) {
      assert.equal(canonicalSourceEventUrl(url), null);
    }
  });

  it("does not treat a configured listing shared by different events as identity", () => {
    const listing = "https://music.example.com/2026-summer-concert-series.html";
    assert.equal(sourceEventUrlsOverlap(
      { calendarSourceUrl: `${listing}?utm_source=email` },
      { website: listing },
      [listing],
    ), false);
  });
});
