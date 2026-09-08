import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasDestinationInventoryHold, withoutDestinationHold } from "../src/lib/eventHolds";

describe("releasing the destination hold", () => {
  it("drops a reason that was only the hold", () => {
    assert.equal(withoutDestinationHold("Missing before publish: destination_inventory_unavailable"), null);
  });

  it("keeps the other issues and the prefix", () => {
    const reason = "Missing before publish: image_missing, destination_inventory_unavailable, phone_missing";
    assert.equal(withoutDestinationHold(reason), "Missing before publish: image_missing, phone_missing");
    assert.equal(
      withoutDestinationHold("Auto-rejected (incomplete): image_missing, destination_inventory_unavailable"),
      "Auto-rejected (incomplete): image_missing",
    );
  });

  it("leaves reasons without a hold alone", () => {
    assert.equal(withoutDestinationHold(null), null);
    assert.equal(withoutDestinationHold("Missing before publish: image_missing"), "Missing before publish: image_missing");
    assert.equal(hasDestinationInventoryHold("Missing before publish: image_missing"), false);
  });
});
