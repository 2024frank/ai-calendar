import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractionOrder, validationOptionsForSource } from "../src/lib/sourcePolicy";

describe("source extraction order", () => {
  it("reads aggregators after original organizations and keeps the rest of the order", () => {
    const ordered = extractionOrder([
      { id: 20, sourceKind: "aggregator" },
      { id: 18, sourceKind: "original_org" },
      { id: 19 },
      { id: 21, sourceKind: "aggregator" },
      { id: 22, sourceKind: "original_org" },
    ]);
    assert.deepEqual(ordered.map((s) => s.id), [18, 19, 22, 20, 21]);
  });

  it("does not mutate the input", () => {
    const input = [{ id: 1, sourceKind: "aggregator" }, { id: 2, sourceKind: "original_org" }];
    extractionOrder(input);
    assert.deepEqual(input.map((s) => s.id), [1, 2]);
  });
});

describe("announcement date policy", () => {
  it("lets any announcement keep dates in its long description, and only Apollo in its short one", () => {
    const fava = validationOptionsForSource({ slug: "fava-gallery" }, { slug: "oberlin" }, "an");
    assert.equal(fava.allowDateInExtendedDescription, true);
    assert.equal(fava.allowDateInDescription, false);
    const apollo = validationOptionsForSource({ slug: "apollo-theater" }, { slug: "oberlin" }, "an");
    assert.equal(apollo.allowDateInExtendedDescription, true);
    assert.equal(apollo.allowDateInDescription, true);
  });

  it("keeps events date-free in both descriptions", () => {
    const event = validationOptionsForSource({ slug: "fava-gallery" }, { slug: "oberlin" }, "ot");
    assert.equal(event.allowDateInExtendedDescription, false);
    assert.equal(event.allowDateInDescription, false);
  });
});
