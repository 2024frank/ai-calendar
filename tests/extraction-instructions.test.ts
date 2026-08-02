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
    assert.doesNotMatch(rule, /description|calendarSourceUrl|registrationUrl/);

    const prompt = buildSystemPrompt({
      sourceName: "Riverdog Music",
      urls: ["https://riverdogmusic.weebly.com/shows.html"],
      calendarSourceName: "Riverdog Music",
      lookaheadDays: 21,
    });
    assert.match(prompt, /More info and videos/);
    assert.match(prompt, /DETAIL-PAGE RULE FOR EVERY SOURCE/);
    assert.match(prompt, /BOTH description and extendedDescription/);
    assert.match(prompt, /21 DAYS AHEAD ONLY/);
    assert.match(prompt, /hard limit for every source/);
    assert.match(prompt, /DEAD-LINK RULE FOR EVERY SOURCE/);
    assert.match(prompt, /Back up one path level at a time/);
    assert.match(prompt, /no callback credential/i);
    assert.match(prompt, /RETURN the final JSON object/);
    assert.doesNotMatch(prompt, /api\/agent\/ingest|test-token|urllib\.request|"token"/);
  });

  it("gives the detail-page rule to non-Riverdog agents", () => {
    const prompt = buildSystemPrompt({
      sourceName: "Example Museum",
      urls: ["https://example.com/events"],
      calendarSourceName: "Example Museum",
    });
    assert.match(prompt, /DETAIL-PAGE RULE FOR EVERY SOURCE/);
    assert.match(prompt, /BOTH description and extendedDescription/);
    assert.doesNotMatch(prompt, /More info and videos/);
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
  it("backs up to the nearest working path before a configured listing", () => {
    assert.deepEqual(
      sourceLinkFallbackCandidates(
        "https://example.com/events/music/broken-event",
        ["https://example.com/calendar"],
      ),
      [
        "https://example.com/events/music/",
        "https://example.com/events/",
        "https://example.com/calendar",
        "https://example.com/",
      ],
    );
  });

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
