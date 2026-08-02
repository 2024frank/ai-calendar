import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalCommunityHubPostUrl,
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
