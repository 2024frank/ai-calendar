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
