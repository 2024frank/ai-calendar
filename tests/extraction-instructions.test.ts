import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSystemPrompt,
  builtInSourceInstructions,
  eventWithinLookahead,
  normalizeEvent,
} from "../src/lib/contract";
import { sourceLinkFallbackCandidates } from "../src/lib/sourceLinks";

describe("shared extraction instructions", () => {
  it("requires Riverdog detail pages for both descriptions", () => {
    const rule = builtInSourceInstructions("Riverdog Music");
    assert.match(rule, /More info and videos/);
    assert.match(rule, /BOTH description and extendedDescription/);

    const prompt = buildSystemPrompt({
      sourceName: "Riverdog Music",
      urls: ["https://riverdogmusic.weebly.com/shows.html"],
      calendarSourceName: "Riverdog Music",
      ingestUrl: "https://calendar.example.com/api/agent/ingest",
      runId: 1,
      runToken: "test-token",
      lookaheadDays: 21,
    });
    assert.match(prompt, /More info and videos/);
    assert.match(prompt, /21 DAYS AHEAD ONLY/);
    assert.match(prompt, /hard limit for every source/);
    assert.match(prompt, /DEAD-LINK RULE FOR EVERY SOURCE/);
  });
});

describe("lookahead enforcement", () => {
  const nowSeconds = 2_000_000_000;

  it("keeps ongoing and in-window events but rejects later events", () => {
    assert.equal(
      eventWithinLookahead(
        { sessions: [{ startTime: nowSeconds - 60, endTime: nowSeconds + 60 }] } as ReturnType<typeof normalizeEvent>,
        14,
        nowSeconds,
      ),
      true,
    );
    assert.equal(
      eventWithinLookahead(
        { sessions: [{ startTime: nowSeconds + 14 * 86400, endTime: nowSeconds + 14 * 86400 + 60 }] } as ReturnType<typeof normalizeEvent>,
        14,
        nowSeconds,
      ),
      true,
    );
    assert.equal(
      eventWithinLookahead(
        { sessions: [{ startTime: nowSeconds + 14 * 86400 + 1, endTime: nowSeconds + 14 * 86400 + 61 }] } as ReturnType<typeof normalizeEvent>,
        14,
        nowSeconds,
      ),
      false,
    );
  });

  it("allows sessionless records through to normal validation", () => {
    assert.equal(
      eventWithinLookahead({ sessions: [] } as unknown as ReturnType<typeof normalizeEvent>, 14, nowSeconds),
      true,
    );
  });
});

describe("dead event link fallback", () => {
  it("prefers the configured source listing over a generic homepage", () => {
    assert.deepEqual(
      sourceLinkFallbackCandidates(
        "https://riverdogmusic.weebly.com/liam-purcell.html",
        ["https://riverdogmusic.weebly.com/shows.html"],
      ),
      [
        "https://riverdogmusic.weebly.com/shows.html",
        "https://riverdogmusic.weebly.com/",
      ],
    );
  });

  it("ignores unsafe fallback URLs", () => {
    assert.deepEqual(
      sourceLinkFallbackCandidates("not a url", ["http://127.0.0.1/admin", "https://example.com/events"]),
      ["https://example.com/events"],
    );
  });
});
