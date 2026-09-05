import assert from "node:assert/strict";
import { it } from "node:test";
import { validateEvaluation, compareEvaluation, MAX_EVALUATION_BYTES } from "../src/lib/evaluation";
import { fixture } from "./fixtures/evaluation";

it("compares explicit one-to-one human matches with both unmatched directions and exact field differences", () => {
  const input = validateEvaluation(fixture());
  const report = compareEvaluation(input);
  assert.deepEqual(report.referenceOnly.map((r) => r.id), ["B"]);
  assert.deepEqual(report.extractedOnly.map((r) => r.id), ["c"]);
  assert.equal(report.referenceCoveragePct, 50);
  assert.equal(report.matches[0].differences.length, 1);
  assert.deepEqual(report.matches[0].differences[0], { field: "location", reference: "Hall", extracted: "Park" });
  assert.equal(input.extracted[0].startTime, "2026-09-10T18:00:00.000Z");
  assert.equal("falsePositiveRate" in report, false);
});

it("returns unavailable for empty denominators and never auto-matches identical records", () => {
  const f = fixture(); f.reference = []; f.matches = [];
  assert.equal(compareEvaluation(validateEvaluation(f)).referenceCoveragePct, null);
  const same = fixture(); same.matches = [];
  const result = compareEvaluation(validateEvaluation(same));
  assert.equal(result.referenceCoveragePct, 0);
  assert.equal(result.extractedOnly.length, 2);
});

it("does not mutate uploaded snapshots and preserves a partial reference declaration", () => {
  const f = fixture(); f.scope.referenceCompleteness = "partial";
  const before = structuredClone(f);
  const report = compareEvaluation(validateEvaluation(f));
  assert.deepEqual(f, before);
  assert.equal(report.referenceCompleteness, "partial");
});

for (const [name, alter] of [
  ["duplicate IDs", (f: ReturnType<typeof fixture>) => { f.reference[1].id = "A"; }],
  ["many-to-one matches", (f: ReturnType<typeof fixture>) => { f.matches.push({ referenceId: "B", extractedId: "a" }); }],
  ["unknown match IDs", (f: ReturnType<typeof fixture>) => { f.matches[0].referenceId = "missing"; }],
  ["out-of-scope dates", (f: ReturnType<typeof fixture>) => { f.reference[0].startTime = "2026-10-01T00:00:00Z"; }],
  ["invalid dates", (f: ReturnType<typeof fixture>) => { f.reference[0].startTime = "2026-02-30T00:00:00Z"; }],
  ["missing provenance", (f: ReturnType<typeof fixture>) => { f.provenance.reference.description = ""; }],
  ["unconfirmed scope", (f: ReturnType<typeof fixture>) => { f.scope.confirmed = false; }],
  ["unconfirmed matches", (f: ReturnType<typeof fixture>) => { f.humanConfirmedMatches = false; }],
  ["nonindependent reference", (f: ReturnType<typeof fixture>) => { f.provenance.reference.independent = false; }],
  ["too many records", (f: ReturnType<typeof fixture>) => { f.reference = Array.from({ length: 501 }, (_, i) => ({ ...f.reference[0], id: String(i) })); }],
] as const) {
  it(`rejects ${name}`, () => { const f = fixture(); alter(f); assert.throws(() => validateEvaluation(f)); });
}

it("bounds total input bytes and rejects non-objects", () => {
  assert.throws(() => validateEvaluation({ extra: "x".repeat(MAX_EVALUATION_BYTES + 1) }), /large/i);
  assert.throws(() => validateEvaluation(null));
});
