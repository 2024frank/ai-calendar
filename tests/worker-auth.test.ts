import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authorizedWorkerBearer, ownWorkerSecret, workerSecrets } from "../src/lib/workerAuth";

describe("worker bearer secrets", () => {
  it("accepts any listed secret and uses the first for self-dispatch", () => {
    const env = { WORKER_SECRET: " ours , theirs ", CRON_SECRET: "cron" };
    assert.deepEqual(workerSecrets(env), ["ours", "theirs"]);
    assert.equal(ownWorkerSecret(env), "ours");
    assert.equal(authorizedWorkerBearer("Bearer ours", env), true);
    assert.equal(authorizedWorkerBearer("Bearer theirs", env), true);
    assert.equal(authorizedWorkerBearer("Bearer cron", env), false);
  });

  it("falls back to the cron secret only when no worker secret is set", () => {
    const env = { CRON_SECRET: "cron" };
    assert.deepEqual(workerSecrets(env), ["cron"]);
    assert.equal(authorizedWorkerBearer("Bearer cron", env), true);
    assert.equal(authorizedWorkerBearer("Bearer cron", { WORKER_SECRET: "", CRON_SECRET: "cron" }), true);
  });

  it("rejects missing, malformed, partial and empty credentials", () => {
    const env = { WORKER_SECRET: "ours" };
    assert.equal(authorizedWorkerBearer(null, env), false);
    assert.equal(authorizedWorkerBearer("ours", env), false);
    assert.equal(authorizedWorkerBearer("Bearer our", env), false);
    assert.equal(authorizedWorkerBearer("Bearer ", env), false);
    assert.equal(authorizedWorkerBearer("Bearer ours", {}), false);
    assert.equal(ownWorkerSecret({}), null);
  });
});
