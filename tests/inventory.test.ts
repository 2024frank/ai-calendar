import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadRoute } from "./helpers/load-route";

describe("destination inventory availability", () => {
  async function inventory(response: unknown, configured = true, timeoutMs = 25_000) {
    let requests = 0;
    const mod = loadRoute<{ fetchDestinationInventory(id: number, sourceId?: number, timeoutMs?: number): Promise<{
      available: boolean; items: unknown[]; reason?: string;
    }> }>(new URL("../src/lib/inventory.ts", import.meta.url), {
      "server-only": {},
      "./destination": { resolveDestination: async () => ({ destination: configured ? {
        config: { inventory_url: "https://hub.example/api/posts", api_base: "https://hub.example" },
      } : null }) },
      "./fetchPage": { fetchPublicBytes: async () => {
        requests++;
        if (response instanceof Error) throw response;
        return { ok: true, bytes: new TextEncoder().encode(JSON.stringify(response)) };
      } },
    });
    const result = await mod.fetchDestinationInventory(7, undefined, timeoutMs);
    return { ...result, requests };
  }

  it("distinguishes a destination outage from an empty calendar", async () => {
    const unavailable = await inventory(new Error("network down"));
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.items.length, 0);
    const empty = await inventory({ posts: [] });
    assert.equal(empty.available, true);
    assert.equal(empty.items.length, 0);
  });

  it("does not trust an unexpected success response as an empty inventory", async () => {
    assert.equal((await inventory({ message: "login required" })).available, false);
  });

  it("preserves announcement kind and full display bounds for Apollo duplicate proof", async () => {
    const result = await inventory({ posts: [{
      id: 42,
      name: "Playing Now at the Apollo",
      eventType: "an",
      description: "The Dog Stars: Sep 1 to Sep 10",
      sessions: [{ start: "1788235200", end: "1789099140" }],
    }] });
    assert.equal(result.available, true);
    assert.deepEqual(result.items[0], {
      eventType: "an",
      title: "Playing Now at the Apollo",
      description: "The Dog Stars: Sep 1 to Sep 10",
      startTimes: [1788235200],
      sessions: [{ startTime: 1788235200, endTime: 1789099140 }],
      location: null,
      sourceUrls: [],
      url: "https://hub.example/calendar/post/42",
    });
  });

  it("does not invent missing announcement kinds or session end times", async () => {
    const result = await inventory({ posts: [{
      name: "Playing Now at the Apollo",
      sessions: [{ start: 1788235200 }, { start: 1788235200, end: "invalid" }],
    }] });
    const item = result.items[0] as { eventType: unknown; sessions: unknown[]; startTimes: number[] };
    assert.equal(item.eventType, null);
    assert.deepEqual(item.sessions, []);
    assert.deepEqual(item.startTimes, [1788235200, 1788235200]);
  });

  it("does not require a remote inventory for a local-only calendar", async () => {
    assert.equal((await inventory(null, false)).available, true);
  });

  it("holds a configured destination without starting a request when its network budget is exhausted", async () => {
    const result = await inventory({ posts: [] }, true, 0);
    assert.equal(result.available, false);
    assert.equal(result.requests, 0);
  });

  it("keeps a local-only calendar available even with no network budget", async () => {
    const result = await inventory(null, false, 0);
    assert.equal(result.available, true);
    assert.equal(result.requests, 0);
  });
});
