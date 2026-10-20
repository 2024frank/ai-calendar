import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeEvent, normalizePhone } from "../src/lib/contract";

describe("phone extension normalization", () => {
  it("strips extension suffixes CommunityHub cannot accept", () => {
    assert.equal(normalizePhone("(440) 775-1711 ext. 1"), "(440) 775-1711");
    assert.equal(normalizePhone("440-775-1711 ext 12"), "440-775-1711");
    assert.equal(normalizePhone("440-775-1711 x3"), "440-775-1711");
    assert.equal(normalizePhone("440-775-1711 extension 42"), "440-775-1711");
  });

  it("leaves ordinary numbers untouched", () => {
    assert.equal(normalizePhone("440-775-1711"), "440-775-1711");
    assert.equal(normalizePhone("(440) 775-1711"), "(440) 775-1711");
    assert.equal(normalizePhone(""), null);
    assert.equal(normalizePhone(null), null);
  });

  it("applies during event normalization", () => {
    const e = normalizeEvent({ phone: "(440) 775-1711 ext. 1" });
    assert.equal(e.phone, "(440) 775-1711");
  });
});
