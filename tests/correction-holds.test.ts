import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as schema from "../src/db/schema";
import { HARD_ISSUES } from "../src/lib/contract";
import { loadRoute } from "./helpers/load-route";

describe("automatic correction publishing holds", () => {
  async function correct(reason: string) {
    const event = {
      id: 41, sourceId: 2, communityId: 3, status: "auto_rejected", eventType: "ot",
      title: "Community Art Workshop", description: null, extendedDescription: null,
      sponsors: ["Example Arts Center"], imageCdnUrl: "https://example.com/image.jpg", imageData: null,
      website: "https://example.com/event", contactEmail: "events@example.com", phone: "440-555-0100",
      postTypeIds: [89], sessions: [{ startTime: 2_000_000_000, endTime: 2_000_007_200 }],
      locationType: "ph2", location: "Example Arts Center", urlLink: null, registrationUrl: null,
      rejectionReason: reason,
    };
    const results = [
      [event],
      [{ id: 2, communityId: 3, slug: "arts-center", name: "Arts Center", url: event.website }],
      [{ id: 3, slug: "example", timezone: "America/New_York" }],
      [{ n: 0 }],
    ];
    const changes: Array<Record<string, unknown>> = [];
    const db = {
      select: () => {
        const result = results.shift();
        const query = {
          from: () => query, where: () => query, limit: async () => result,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
        };
        return query;
      },
      update: (table: unknown) => ({ set: (patch: Record<string, unknown>) => ({
        where: async () => { if (table === schema.events) changes.push(patch); },
      }) }),
    };
    const { correctNextEvent } = loadRoute<{
      correctNextEvent(runId: number, sourceId: number, communityId: number): Promise<{ fixed: boolean }>;
    }>(new URL("../src/lib/correction.ts", import.meta.url), {
      "server-only": {}, "@/db": { db }, "@/db/schema": schema,
      "./ingest": { HARD_ISSUES },
      "./llm": { llmComplete: async () => ({ text: JSON.stringify({ found: true, description: "Neighbors can learn printmaking techniques from local artists." }) }) },
      "./models": { modelChain: async () => ["test-model"] },
      "./runEvents": { emit: async () => undefined },
      "./mergePosters": { mergePosterImages: async () => { throw new Error("Unexpected image download"); } },
      "./fetchPage": { fetchPage: async () => { throw new Error("Unexpected page download"); } },
    });
    const result = await correctNextEvent(9, 2, 3);
    assert.equal(result.fixed, true);
    return changes.find((patch) => patch.status === "pending");
  }

  it("restores corrected events to review without dropping the inventory hold", async () => {
    const saved = await correct("Auto-rejected (incomplete): description_missing, destination_inventory_unavailable");
    assert.equal(saved?.rejectionReason, "Missing before publish: destination_inventory_unavailable");
    assert.equal(saved?.description, "Neighbors can learn printmaking techniques from local artists.");
  });

  it("clears fixed field warnings for events without an operational hold", async () => {
    const saved = await correct("Auto-rejected (incomplete): description_missing");
    assert.equal(saved?.rejectionReason, null);
  });
});
