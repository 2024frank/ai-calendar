import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { compareEvaluation, validateEvaluation } from "../src/lib/evaluation";

it("the synthetic browser comparison agrees with the actual research calculator", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/pilot-evaluation.json", import.meta.url), "utf8"));
  const input = validateEvaluation(fixture.snapshot);
  assert.deepEqual(compareEvaluation(input), fixture.report);
  assert.equal(fixture.report.referenceCoveragePct, 50);
  assert.equal(fixture.report.referenceOnly[0].id, "ref-B");
  assert.equal(fixture.report.extractedOnly[0].id, "ext-C");
  assert.equal(fixture.creator.name, "Synthetic reviewer");
});
