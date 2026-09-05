import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as schema from "../src/db/schema";
import { automaticPublishHoldReason } from "../src/lib/publishPolicy";
import { loadRoute } from "./helpers/load-route";

describe("refreshing pending flags", () => {
  async function refresh(reason: string | null, overrides: Record<string, unknown> = {}) {
    const event = {
      id: 41, status: "pending", eventType: "ot", title: "Community Art Workshop",
      description: "Neighbors can learn printmaking techniques from local artists.",
      extendedDescription: null, sponsors: ["Example Arts Center"], imageCdnUrl: "https://example.com/image.jpg",
      hasImage: 0, website: "https://example.com/event", contactEmail: "events@example.com", phone: "440-555-0100",
      postTypeIds: [89], sessions: [{ startTime: 2_000_000_000, endTime: 2_000_007_200 }],
      locationType: "ph2", location: "Example Arts Center", urlLink: null, registrationUrl: null,
      sourceSlug: "arts-center", communitySlug: "example", rejectionReason: reason, ...overrides,
    };
    let saved = reason;
    const query = { from: () => query, leftJoin: () => query, where: () => query, limit: async () => [event] };
    const db = {
      select: () => query,
      update: () => ({ set: (patch: { rejectionReason: string | null }) => ({ where: async () => { saved = patch.rejectionReason; } }) }),
    };
    const { refreshPendingFlag } = loadRoute<{ refreshPendingFlag(id: number): Promise<void> }>(
      new URL("../src/lib/flags.ts", import.meta.url),
      { "server-only": {}, "@/db": { db }, "@/db/schema": schema },
    );
    await refreshPendingFlag(41);
    return saved;
  }

  it("keeps the automatic-publishing hold after a no-op save", async () => {
    const reason = await refresh("Missing before publish: destination_inventory_unavailable");
    assert.ok(automaticPublishHoldReason({ rejectionReason: reason }, "submitted"));
    assert.ok(automaticPublishHoldReason({ rejectionReason: reason }, "published"));
    assert.equal(automaticPublishHoldReason({ rejectionReason: reason }, "approved"), null);
  });

  it("clears corrected field warnings without clearing the operational hold", async () => {
    const reason = await refresh("Missing before publish: image_missing, destination_inventory_unavailable");
    assert.equal(reason, "Missing before publish: destination_inventory_unavailable");
  });

  it("continues clearing ordinary obsolete field warnings", async () => {
    assert.equal(await refresh("Missing before publish: image_missing"), null);
  });

  it("keeps current field problems alongside the hold", async () => {
    const reason = await refresh("Missing before publish: destination_inventory_unavailable", { phone: null });
    assert.ok(reason?.includes("phone_missing"));
    assert.ok(reason?.includes("destination_inventory_unavailable"));
  });
});
