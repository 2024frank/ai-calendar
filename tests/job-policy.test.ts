import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_DRAIN_BATCH,
  MAX_WORKER_RECOVERY_DISPATCHES,
  QUEUED_JOB_MAX_WAIT_MS,
  QUEUED_RUN_DEADLINE_MS,
  STALE_JOB_LEASE_MS,
  drainBatchSize,
  nextWorkerRecoveryAttempt,
  shouldContinueWorkerChain,
  terminalJobStatus,
  workerRecoveryAttempt,
} from "../src/lib/jobPolicy";
import { hasDatabaseErrorCode } from "../src/lib/dbError";

describe("job policy", () => {
  it("recognizes duplicate-key errors wrapped by Drizzle", () => {
    const wrapped = new Error("Failed query", {
      cause: Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }),
    });
    assert.equal(hasDatabaseErrorCode(wrapped, "ER_DUP_ENTRY"), true);
    assert.equal(hasDatabaseErrorCode(wrapped, "ER_LOCK_DEADLOCK"), false);
  });
  it("uses bounded leases and queue deadlines", () => {
    assert.equal(STALE_JOB_LEASE_MS, 15 * 60_000);
    assert.equal(QUEUED_RUN_DEADLINE_MS, 60 * 60_000);
    assert.equal(QUEUED_JOB_MAX_WAIT_MS, 6 * 60 * 60_000);
    assert.ok(STALE_JOB_LEASE_MS < QUEUED_RUN_DEADLINE_MS);
    assert.ok(QUEUED_RUN_DEADLINE_MS < QUEUED_JOB_MAX_WAIT_MS);
  });

  it("reconciles terminal run states to the owning job", () => {
    assert.equal(terminalJobStatus("completed"), "succeeded");
    assert.equal(terminalJobStatus("failed"), "failed");
    assert.equal(terminalJobStatus("stopped"), "failed");
    assert.equal(terminalJobStatus("running"), null);
  });

  it("clamps drain batches to a small positive integer", () => {
    assert.equal(drainBatchSize(-10), 1);
    assert.equal(drainBatchSize(0), 1);
    assert.equal(drainBatchSize(1.9), 1);
    assert.equal(drainBatchSize(3.9), 3);
    assert.equal(drainBatchSize(MAX_DRAIN_BATCH), MAX_DRAIN_BATCH);
    assert.equal(drainBatchSize(MAX_DRAIN_BATCH + 100), MAX_DRAIN_BATCH);
  });

  it("continues a worker chain only after claiming work with more remaining", () => {
    assert.equal(shouldContinueWorkerChain(1, 1), true);
    assert.equal(shouldContinueWorkerChain(5, 12), true);
    assert.equal(shouldContinueWorkerChain(0, 1), false);
    assert.equal(shouldContinueWorkerChain(1, 0), false);
    assert.equal(shouldContinueWorkerChain(0, 0), false);
  });

  it("bounds worker-chain recovery attempts", () => {
    assert.equal(workerRecoveryAttempt(null), 0);
    assert.equal(workerRecoveryAttempt("invalid"), 0);
    assert.equal(workerRecoveryAttempt("1"), 1);
    assert.equal(workerRecoveryAttempt("999"), MAX_WORKER_RECOVERY_DISPATCHES);
    assert.equal(nextWorkerRecoveryAttempt(0), 1);
    assert.equal(nextWorkerRecoveryAttempt(1), 2);
    assert.equal(nextWorkerRecoveryAttempt(MAX_WORKER_RECOVERY_DISPATCHES), null);
  });
});
