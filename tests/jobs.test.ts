import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it, type TestContext } from "node:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "../src/db/schema";
import { loadRoute } from "./helpers/load-route";

type WorkerModule = typeof import("../src/lib/jobs");
const NOW = new Date("2026-09-05T12:00:00.000Z");

// Executes real Drizzle SQL against a disposable store. MySQL isolation still
// requires the staging kill-and-reclaim release check.
function fixture(t: TestContext, extract: () => Promise<void> = async () => {}) {
  const store = new DatabaseSync(":memory:");
  t.after(() => store.close());
  store.exec(`
    CREATE TABLE runs (
      id INTEGER PRIMARY KEY, status TEXT, phase TEXT, deadline_at TEXT,
      finished_at TEXT, error_log TEXT
    );
    CREATE TABLE jobs (
      id INTEGER PRIMARY KEY, run_id INTEGER, kind TEXT, status TEXT,
      dedupe_key TEXT UNIQUE, attempts INTEGER, max_attempts INTEGER,
      available_at TEXT, locked_at TEXT, locked_by TEXT, last_error TEXT,
      created_at TEXT, updated_at TEXT
    );
    INSERT INTO runs (id, status, phase) VALUES (1, 'running', 'fetching');
    INSERT INTO jobs VALUES (
      1, 1, 'extract_source', 'running', 'extract-source:1', 1, 2,
      '2026-09-04 10:00:00.000', '2026-09-05 10:00:00.000', 'old-worker', null,
      '2026-09-04 10:00:00.000', '2026-09-04 10:00:00.000'
    );
  `);
  let afterRead: ((query: string) => void | Promise<void>) | undefined;
  const db = drizzle(async (query, params, method) => {
    // SQLite has no row-lock clause. These deterministic interleavings verify
    // ownership predicates; they do not claim to model MySQL lock scheduling.
    const statement = store.prepare(query.replace(/ for update$/, ""));
    if (method === "all") {
      statement.setReturnArrays(true);
      const rows = statement.all(...params);
      await afterRead?.(query);
      return { rows };
    }
    const result = statement.run(...params);
    return { rows: [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }] };
  });
  db.transaction = async (work) => {
    store.exec("BEGIN");
    try {
      const result = await work(db as unknown as Parameters<typeof work>[0]);
      store.exec("COMMIT");
      return result;
    } catch (error) {
      store.exec("ROLLBACK");
      throw error;
    }
  };
  const worker = loadRoute<WorkerModule>(new URL("../src/lib/jobs.ts", import.meta.url), {
    "server-only": {},
    "@/db": { db },
    "@/db/schema": schema,
    "./agent": { runExtraction: extract },
  });
  return {
    worker, store,
    afterRead(hook: (query: string) => void | Promise<void>) { afterRead = hook; },
    queue() {
      store.exec("UPDATE jobs SET status = 'queued', attempts = 0, available_at = '2000-01-01 00:00:00.000', locked_at = null, locked_by = null; UPDATE runs SET phase = 'queued'");
    },
    job: () => store.prepare("SELECT * FROM jobs WHERE id = 1").get()!,
    run: () => store.prepare("SELECT * FROM runs WHERE id = 1").get()!,
  };
}

it("closes the run when extraction returns without a terminal result", async (t) => {
  const f = fixture(t);
  f.queue();
  assert.equal(await f.worker.processJob(1), false);
  assert.equal(f.job().status, "failed");
  assert.equal(f.run().status, "failed");
  assert.equal(f.run().phase, "done");
  assert.ok(f.run().finished_at);
});

it("does not steal a replacement worker's lease after reading a stale snapshot", async (t) => {
  const f = fixture(t);
  f.afterRead((query) => {
    if (query.includes("inner join")) {
      f.store.exec("UPDATE jobs SET locked_at = '2026-09-05 11:59:00.000', locked_by = 'replacement', attempts = 2");
    }
  });
  const recovered = await f.worker.requeueStaleJobs(NOW);
  assert.equal(f.job().status, "running");
  assert.equal(f.job().locked_by, "replacement");
  assert.equal(recovered.requeued, 0);
});

it("does not fail a replacement worker's run from an exhausted stale snapshot", async (t) => {
  const f = fixture(t);
  f.store.exec("UPDATE jobs SET attempts = 2");
  f.afterRead((query) => {
    if (query.includes("inner join")) {
      f.store.exec("UPDATE jobs SET locked_at = '2026-09-05 11:59:00.000', locked_by = 'replacement'");
    }
  });
  const recovered = await f.worker.requeueStaleJobs(NOW);
  assert.equal(f.job().status, "running");
  assert.equal(f.run().status, "running");
  assert.equal(recovered.failed, 0);
});

it("preserves a completed callback result when the worker later throws", async (t) => {
  const f = fixture(t, async () => {
    f.store.exec("UPDATE runs SET status = 'completed', phase = 'done'");
    throw new Error("telemetry connection closed after completion");
  });
  f.queue();
  await f.worker.processJob(1);
  assert.equal(f.run().status, "completed");
  assert.equal(f.job().status, "succeeded");
});

it("reconciles an already completed run without executing it again", async (t) => {
  let extractions = 0;
  const f = fixture(t, async () => { extractions += 1; });
  f.queue();
  f.store.exec("UPDATE runs SET status = 'completed', phase = 'done'");
  await f.worker.processJob(1);
  assert.equal(extractions, 0);
  assert.equal(f.job().status, "succeeded");
});

it("does not let a worker that lost its lease fail the replacement run", async (t) => {
  const f = fixture(t, async () => {
    f.store.exec("UPDATE jobs SET locked_by = 'replacement'");
    throw new Error("old invocation failed");
  });
  f.queue();
  await f.worker.processJob(1, "old-worker");
  assert.equal(f.job().status, "running");
  assert.equal(f.job().locked_by, "replacement");
  assert.equal(f.run().status, "running");
});

it("requeues a claim abandoned before extraction started and preserves its deduplication key", async (t) => {
  const f = fixture(t);
  f.store.exec("UPDATE runs SET phase = 'queued'");
  const recovered = await f.worker.requeueStaleJobs(NOW);
  assert.equal(recovered.requeued, 1);
  assert.equal(f.job().status, "queued");
  assert.equal(f.job().dedupe_key, "extract-source:1");
  assert.equal(f.run().phase, "queued");
});

it("closes an abandoned started extraction so its run ID cannot be reused", async (t) => {
  const f = fixture(t);
  const recovered = await f.worker.requeueStaleJobs(NOW);
  assert.equal(recovered.failed, 1);
  assert.equal(recovered.requeued, 0);
  assert.equal(f.run().status, "failed");
  assert.equal(f.job().status, "failed");
  assert.equal(f.job().dedupe_key, null);
});

for (const phase of ["awaiting_callback", "ingesting"]) {
  it(`retains the active job while a ${phase} delivery is within its deadline`, async (t) => {
    const f = fixture(t, async () => {
      f.store.prepare("UPDATE runs SET phase = ?, deadline_at = ?").run(
        phase, new Date(Date.now() + 60_000).toISOString().replace("T", " ").replace("Z", ""),
      );
    });
    f.queue();
    await f.worker.processJob(1);
    assert.equal(f.job().status, "running");
    assert.equal(f.job().dedupe_key, "extract-source:1");
    assert.equal(f.run().status, "running");
    assert.equal(f.run().phase, phase);
  });

  it(`does not recover a ${phase} delivery before its deadline`, async (t) => {
    const f = fixture(t);
    f.store.prepare("UPDATE runs SET phase = ?, deadline_at = ?").run(phase, "2026-09-05 13:00:00.000");
    const recovered = await f.worker.requeueStaleJobs(NOW);
    assert.equal(recovered.requeued, 0);
    assert.equal(f.job().status, "running");
    assert.equal(f.run().phase, phase);
  });

  it(`closes an expired ${phase} delivery instead of starting overlapping ingestion`, async (t) => {
    const f = fixture(t);
    f.store.prepare("UPDATE runs SET phase = ?, deadline_at = ?").run(phase, "2026-09-05 11:00:00.000");
    const recovered = await f.worker.requeueStaleJobs(NOW);
    assert.equal(recovered.failed, 1);
    assert.equal(recovered.requeued, 0);
    assert.equal(f.job().status, "failed");
    assert.equal(f.job().dedupe_key, null);
    assert.equal(f.run().status, "failed");
  });
}

it("releases the job as soon as its callback completes, without waiting for lease expiry", async (t) => {
  const f = fixture(t);
  f.store.exec("UPDATE runs SET status = 'completed', phase = 'done'; UPDATE jobs SET locked_at = '2026-09-05 11:59:00.000'");
  const recovered = await f.worker.requeueStaleJobs(NOW);
  assert.equal(recovered.orphaned, 1);
  assert.equal(f.job().status, "succeeded");
  assert.equal(f.job().dedupe_key, null);
});

it("preserves ingestion claimed after the recovery scan", async (t) => {
  const f = fixture(t);
  f.afterRead((query) => {
    if (query.includes("inner join")) {
      f.store.exec("UPDATE runs SET phase = 'ingesting', deadline_at = '2026-09-05 13:00:00.000'");
    }
  });
  const recovered = await f.worker.requeueStaleJobs(NOW);
  assert.equal(recovered.requeued, 0);
  assert.equal(f.job().status, "running");
  assert.equal(f.run().phase, "ingesting");
});

it("does not erase a callback claim when starting a previously queued job", async (t) => {
  let extractions = 0;
  const f = fixture(t, async () => { extractions += 1; });
  f.queue();
  f.store.exec("UPDATE runs SET phase = 'ingesting', deadline_at = '2099-01-01 00:00:00.000'");
  await f.worker.processJob(1);
  assert.equal(extractions, 0);
  assert.equal(f.run().phase, "ingesting");
  assert.equal(f.job().status, "running");
});

it("does not expire a queued job that was rescheduled after the candidate scan", async (t) => {
  const f = fixture(t);
  f.queue();
  f.afterRead((query) => {
    if (!query.includes("inner join") && query.includes("from `jobs`")) {
      f.store.exec("UPDATE jobs SET available_at = '2026-09-05 12:00:00.000'");
    }
  });
  const recovered = await f.worker.requeueStaleJobs(NOW);
  assert.equal(recovered.expired, 0);
  assert.equal(f.job().status, "queued");
  assert.equal(f.run().status, "running");
});

it("only the replacement worker starts after the old worker pauses before preparing its run", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: NOW });
  let extractions = 0;
  let releaseOld!: () => void;
  let oldRead!: () => void;
  let releaseReplacement!: () => void;
  let replacementStarted!: () => void;
  const oldPaused = new Promise<void>((r) => { oldRead = r; });
  const holdOld = new Promise<void>((r) => { releaseOld = r; });
  const replacementEntered = new Promise<void>((r) => { replacementStarted = r; });
  const holdReplacement = new Promise<void>((r) => { releaseReplacement = r; });
  const f = fixture(t, async () => {
    extractions += 1;
    if (extractions === 1) { replacementStarted(); await holdReplacement; }
    f.store.exec("UPDATE runs SET status = 'completed', phase = 'done'");
  });
  f.queue();
  let pauseFirstRead = true;
  f.afterRead(async (query) => {
    if (pauseFirstRead && query.includes("from `jobs`") && !query.includes("for update")) {
      pauseFirstRead = false;
      oldRead();
      await holdOld;
    }
  });
  const old = f.worker.processJob(1, "old-worker");
  await oldPaused;
  t.mock.timers.tick(16 * 60_000);
  assert.equal((await f.worker.requeueStaleJobs()).requeued, 1);
  const replacement = f.worker.processJob(1, "replacement-worker");
  await replacementEntered;
  try {
    releaseOld();
    await old;
    assert.equal(extractions, 1);
    assert.equal(f.job().locked_by, "replacement-worker");
  } finally {
    releaseReplacement();
    await replacement;
  }
  assert.equal(f.run().status, "completed");
});

for (const changedField of ["locked_at", "attempts"]) {
  it(`requires the original ${changedField} even when a replacement uses the same worker ID`, async (t) => {
    let extractions = 0;
    const f = fixture(t, async () => { extractions += 1; });
    f.queue();
    let firstRead = true;
    f.afterRead((query) => {
      if (firstRead && query.includes("from `jobs`") && !query.includes("for update")) {
        firstRead = false;
        f.store.exec(changedField === "attempts"
          ? "UPDATE jobs SET attempts = attempts + 1"
          : "UPDATE jobs SET locked_at = '2099-01-01 00:00:00.000'");
      }
    });
    await f.worker.processJob(1, "shared-worker");
    assert.equal(extractions, 0);
    assert.equal(f.job().status, "running");
    assert.equal(f.run().phase, "queued");
  });
}
