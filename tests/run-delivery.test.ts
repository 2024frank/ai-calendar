import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { it, type TestContext } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "../src/db/schema";
import { loadRoute } from "./helpers/load-route";
import * as requestBody from "../src/lib/requestBody";
import * as extractionPolicy from "../src/lib/extractionPolicy";

const counts = { found: 1, inserted: 1, duplicate: 0, invalid: 0, outsideLookahead: 0 };
const response = { text: '{"events":[{"title":"Community concert"}],"duplicates":[]}', usage: { input: 10, output: 20 } };

function fixture(t: TestContext) {
  const store = new DatabaseSync(":memory:");
  t.after(() => store.close());
  for (const [name, table] of [["runs", schema.runs], ["jobs", schema.jobs], ["sources", schema.sources], ["communities", schema.communities]] as const) {
    const columns = Object.values(getTableColumns(table));
    store.exec(`CREATE TABLE ${name} (${columns.map((c) => `\`${c.name}\` ${/int/i.test(c.getSQLType()) ? "INTEGER" : "TEXT"}`).join(",")})`);
  }
  store.exec(`
    INSERT INTO runs (id, source_id, community_id, status, phase, deadline_at)
      VALUES (1, 1, 1, 'running', 'fetching', '2099-01-01 00:00:00.000');
    INSERT INTO jobs (id, run_id, kind, status, dedupe_key, attempts, max_attempts, available_at, locked_at, locked_by)
      VALUES (1, 1, 'extract_source', 'running', 'extract-source:1', 1, 2, '2000-01-01 00:00:00.000', '2000-01-01 00:00:00.000', 'old-worker');
    INSERT INTO sources (id, community_id, name, url, special_instructions)
      VALUES (1, 1, 'Community venue', 'https://example.org/events', 'Read the source in the sandbox.');
    INSERT INTO communities (id, name, slug, timezone)
      VALUES (1, 'Test community', 'test', 'UTC');
  `);
  const db = drizzle(async (query, params, method) => {
    const statement = store.prepare(query.replace(/ for update$/, ""));
    if (method === "all") {
      statement.setReturnArrays(true);
      return { rows: statement.all(...params) };
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
  const calls = { ingestions: 0, models: 0, events: [] as string[] };
  let model = async () => response;
  let ingest = async () => counts;
  let fetch = async () => ({ ok: true, status: 200, bytes: 12, text: "Event listing", jsonLd: [] });
  const common = {
    "server-only": {}, "@/db": { db }, "@/db/schema": schema,
  };
  const runIngestion = loadRoute<typeof import("../src/lib/runIngestion")>(new URL("../src/lib/runIngestion.ts", import.meta.url), common);
  const ingestion = { ingestEvents: async () => { calls.ingestions += 1; return ingest(); } };
  const timeline = { emit: async (_id: number, kind: string) => { calls.events.push(kind); } };
  const agent = loadRoute<typeof import("../src/lib/agent")>(new URL("../src/lib/agent.ts", import.meta.url), {
    ...common,
    "./fetchPage": { fetchPage: () => fetch() },
    "./ingest": ingestion,
    "./agentToken": { runToken: () => "test-token" },
    "./learning": { buildFeedbackBlock: async () => "" },
    "./learningAgent": { lessonsFor: async () => "" },
    "./llm": { llmComplete: async () => { calls.models += 1; return model(); } },
    "./models": { modelChain: async () => ["test-model"] },
    "./runEvents": timeline,
    "./destination": { resolveDestination: async () => ({ destination: null }) },
    "./publicUrl": { assertPublicHttpUrl: async () => new URL("https://example.org/events") },
    "./runIngestion": runIngestion,
  });
  const callback = loadRoute<typeof import("../src/app/api/agent/ingest/route")>(new URL("../src/app/api/agent/ingest/route.ts", import.meta.url), {
    ...common,
    "@/lib/agentToken": { verifyRunToken: () => true },
    "@/lib/ingest": ingestion,
    "@/lib/runEvents": timeline,
    "@/lib/requestBody": requestBody,
    "@/lib/extractionPolicy": extractionPolicy,
    "@/lib/runIngestion": runIngestion,
  });
  const worker = loadRoute<typeof import("../src/lib/jobs")>(new URL("../src/lib/jobs.ts", import.meta.url), {
    ...common, "./agent": agent,
  });
  return {
    store, calls, agent, worker,
    callback: () => callback.POST(new Request("https://example.org/api/agent/ingest", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: 1, token: "test-token", events: [{ title: "Community concert" }] }),
    })),
    model(fn: typeof model) { model = fn; },
    ingest(fn: typeof ingest) { ingest = fn; },
    fetch(fn: typeof fetch) { fetch = fn; },
    run: () => store.prepare("SELECT status, phase, deadline_at FROM runs WHERE id = 1").get()!,
  };
}

it("accepts only one ingestion when callback and returned model output overlap", async (t) => {
  const f = fixture(t);
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((r) => { started = r; });
  const held = new Promise<void>((r) => { release = r; });
  f.ingest(async () => {
    if (f.calls.ingestions === 1) { started(); await held; }
    return counts;
  });
  const callback = f.callback();
  await entered;
  try {
    await f.agent.runExtraction(1);
    assert.equal(f.calls.ingestions, 1);
    assert.equal(f.run().phase, "ingesting");
  } finally {
    release();
    await callback;
  }
});

it("records an explicit wait after the extraction request times out", async (t) => {
  const f = fixture(t);
  f.model(async () => { throw new Error("The operation was aborted due to timeout"); });
  await f.agent.runExtraction(1);
  assert.equal(f.run().status, "running");
  assert.equal(f.run().phase, "awaiting_callback");
});

it("fails a timeout before an extraction request rather than inventing a callback", async (t) => {
  const f = fixture(t);
  f.store.exec("UPDATE sources SET special_instructions = null");
  f.fetch(async () => { throw new Error("The operation was aborted due to timeout"); });
  await f.agent.runExtraction(1);
  assert.equal(f.calls.models, 0);
  assert.equal(f.run().status, "failed");
});

it("rejects callback delivery after its acceptance deadline", async (t) => {
  const f = fixture(t);
  f.store.exec("UPDATE runs SET deadline_at = '2000-01-01 00:00:00.000'");
  const result = await f.callback();
  assert.equal(result.status, 409);
  assert.equal(f.calls.ingestions, 0);
});

it("does not overwrite a completed callback when the model request later fails", async (t) => {
  const f = fixture(t);
  f.model(async () => {
    const delivered = await f.callback();
    assert.equal(delivered.status, 200);
    throw new Error("Model response stream disconnected");
  });
  await f.agent.runExtraction(1);
  assert.equal(f.run().status, "completed");
});

it("rejects a callback while the returned model output already owns ingestion", async (t) => {
  const f = fixture(t);
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((r) => { started = r; });
  const held = new Promise<void>((r) => { release = r; });
  f.ingest(async () => { started(); await held; return counts; });
  const extraction = f.agent.runExtraction(1);
  await entered;
  try {
    const callback = await f.callback();
    assert.equal(callback.status, 409);
    assert.equal(f.calls.ingestions, 1);
  } finally {
    release();
    await extraction;
  }
  assert.equal(f.run().status, "completed");
});

it("leaves the callback's ingestion claim intact if the model times out", async (t) => {
  const f = fixture(t);
  f.store.exec("UPDATE runs SET phase = 'ingesting'");
  f.model(async () => { throw new Error("The operation was aborted due to timeout"); });
  await f.agent.runExtraction(1);
  assert.equal(f.run().status, "running");
  assert.equal(f.run().phase, "ingesting");
  assert.equal(f.calls.ingestions, 0);
});

it("closes a callback that fails during ingestion instead of reopening its partial work", async (t) => {
  const f = fixture(t);
  f.ingest(async () => { throw new Error("persistence unavailable"); });
  await assert.rejects(f.callback, /persistence unavailable/);
  assert.equal(f.run().status, "failed");
  assert.equal(f.run().phase, "done");
  const retry = await f.callback();
  assert.equal(retry.status, 409);
  assert.equal(f.calls.ingestions, 1);
});

it("rejects an old sandbox callback after recovery closes its expired worker", async (t) => {
  const f = fixture(t);
  await f.worker.requeueStaleJobs();
  const result = await f.callback();
  assert.equal(result.status, 409);
  assert.equal(f.calls.ingestions, 0);
  assert.equal(f.run().status, "failed");
});

it("rejects old returned model output when lease recovery happens during its request", async (t) => {
  const f = fixture(t);
  f.model(async () => {
    await f.worker.requeueStaleJobs();
    return response;
  });
  await f.agent.runExtraction(1);
  assert.equal(f.calls.models, 1);
  assert.equal(f.calls.ingestions, 0);
  assert.equal(f.run().status, "failed");
});
