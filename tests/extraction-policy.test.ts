import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FINALIZATION_DEADLINE_MS,
  INGEST_PERSISTENCE_RESERVE_MS,
  PROVIDER_PHASE_BUDGET_MS,
  SERVERLESS_ROUTE_BUDGET_MS,
  optionalIngestBudget,
  remainingProviderBudget,
} from "../src/lib/extractionPolicy";

describe("extraction time policy", () => {
  it("reserves ingestion and shutdown time inside the serverless ceiling", () => {
    assert.ok(PROVIDER_PHASE_BUDGET_MS < FINALIZATION_DEADLINE_MS);
    assert.ok(FINALIZATION_DEADLINE_MS < SERVERLESS_ROUTE_BUDGET_MS);
    assert.ok(
      FINALIZATION_DEADLINE_MS - PROVIDER_PHASE_BUDGET_MS >=
        INGEST_PERSISTENCE_RESERVE_MS,
    );
  });

  it("shares one optional-work budget and preserves persistence time", () => {
    const now = 1_000_000;
    const deadline = now + 80_000;
    assert.equal(optionalIngestBudget(deadline, 60_000, now), 35_000);
    assert.equal(optionalIngestBudget(deadline, 60_000, now + 35_000), 0);
    assert.equal(optionalIngestBudget(undefined, 60_000, now), 60_000);
  });

  it("keeps a shutdown margin on every provider call", () => {
    const now = 2_000_000;
    assert.equal(remainingProviderBudget(now + 100_000, now), 90_000);
    assert.throws(
      () => remainingProviderBudget(now + 14_000, now),
      /execution time budget/,
    );
  });
});
