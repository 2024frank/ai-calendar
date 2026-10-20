import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { humanizeIssues } from "../src/lib/taxonomy";

describe("reviewer wording for session and location flags", () => {
  it("explains the new codes in plain English, not raw identifiers", () => {
    const lines = humanizeIssues(
      "Missing before publish: sessions_overlap, session_too_long, event_location_missing",
    );
    assert.equal(lines.length, 3);
    for (const line of lines) assert.ok(!line.includes("_"), line);
    assert.match(lines[0], /same start/i);
    assert.match(lines[1], /day/i);
    assert.match(lines[2], /venue|online/i);
  });
});
