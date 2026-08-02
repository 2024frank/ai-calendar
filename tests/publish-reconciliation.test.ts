import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isUnresolvedPublishState,
  parsePublishReconciliationOutcome,
  publishSubmissionCanBeReconciled,
  reconciliationTransition,
  SENDING_RECONCILIATION_DELAY_MS,
} from "../src/lib/publishReconciliation";

describe("publish reconciliation policy", () => {
  it("accepts only the two explicit human outcomes", () => {
    assert.equal(parsePublishReconciliationOutcome("published"), "published");
    assert.equal(parsePublishReconciliationOutcome("not_published"), "not_published");
    for (const value of [null, undefined, "", "failed", "succeeded", true, 1]) {
      assert.equal(parsePublishReconciliationOutcome(value), null);
    }
  });

  it("allows reconciliation only from ambiguous submission states", () => {
    assert.equal(isUnresolvedPublishState("sending"), true);
    assert.equal(isUnresolvedPublishState("accepted_unreconciled"), true);
    for (const state of ["prepared", "succeeded", "failed", null]) {
      assert.equal(isUnresolvedPublishState(state), false);
    }
  });

  it("does not allow a reviewer to race an active send", () => {
    const now = Date.parse("2026-08-02T18:00:00.000Z");
    assert.equal(
      publishSubmissionCanBeReconciled("sending", now - SENDING_RECONCILIATION_DELAY_MS + 1, now),
      false,
    );
    assert.equal(
      publishSubmissionCanBeReconciled("sending", now - SENDING_RECONCILIATION_DELAY_MS, now),
      true,
    );
    assert.equal(
      publishSubmissionCanBeReconciled("accepted_unreconciled", now, now),
      true,
    );
    assert.equal(publishSubmissionCanBeReconciled("failed", now - 999_999, now), false);
    assert.equal(publishSubmissionCanBeReconciled("sending", "bad date", now), false);
  });

  it("maps a verified remote post to success and approval", () => {
    assert.deepEqual(reconciliationTransition("published"), {
      submissionState: "succeeded",
      eventStatus: "approved",
    });
  });

  it("maps a verified absence to a safely retryable failed submission", () => {
    assert.deepEqual(reconciliationTransition("not_published"), {
      submissionState: "failed",
      eventStatus: null,
    });
  });
});
