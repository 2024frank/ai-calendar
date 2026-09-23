import assert from "node:assert/strict";
import { it } from "node:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "../src/db/schema";
import { loadRoute } from "./helpers/load-route";

it("counts reviewer decisions from the audit log, so swept events still count", async () => {
  const queries: string[] = [];
  const db = drizzle(async (sql) => {
    queries.push(sql);
    if (sql.includes("`events`.`source_id`") && sql.includes("group by")) return { rows: [[7, "pending", 1, 2]] };
    // Decisions: event 1 rejected then approved (latest wins), event 2 rejected,
    // event 3 approved. Events 2 and 3 no longer exist in the events table.
    if (sql.includes("activity_log") && sql.includes("'approve','reject'"))
      return { rows: [[5, 1, "reject"], [10, 1, "approve"], [11, 2, "reject"], [12, 3, "approve"]] };
    // Edits: event 1 had only a geoScope default fill before approval (not a
    // correction); event 3 had a real title correction before approval.
    if (sql.includes("activity_log") && sql.includes("'edit'"))
      return { rows: [[8, 1, JSON.stringify({ fields: ["geoScope"] })], [9, 3, JSON.stringify({ fields: ["title"] })]] };
    if (sql.includes("run_events")) return { rows: [[40, 25]] };
    return { rows: [] };
  });
  const lib = loadRoute<{ pilotMetrics(): Promise<Record<string, unknown>> }>(new URL("../src/lib/metrics.ts", import.meta.url), {
    "server-only": {}, "@/db": { db }, "@/db/schema": schema, "./models": { activeModel: async () => "test" },
    "./taxonomy": await import("../src/lib/taxonomy"),
  });
  const result = await lib.pilotMetrics();
  assert.equal(result.reviewerApproved, 2, "latest decision per event, including events already swept");
  assert.equal(result.reviewerRejected, 1);
  assert.equal(result.approvalRatePct, 67);
  assert.equal(result.approvedAsIsPct, 50, "a geoScope default fill is not a correction; a title fix is");
  assert.equal(result.eventsGathered, 40, "lifetime intake from the run timeline, not the current table");
  assert.equal(result.duplicatesCaught, 25);
  assert.equal(result.currentUnflaggedPct, 50);
  assert.equal("completeOnArrivalPct" in result, false);
  const correctionQuery = queries.find((sql) => sql.includes("corrected_at"))!;
  assert.match(correctionQuery, /published_via.*reviewer/);
});

it("compares extraction runs only and leaves empty validation denominators unavailable", async () => {
  const db = drizzle(async (sql) => {
    if (sql.includes("group by `runs`.`model`")) return { rows: sql.includes("run_kind") && sql.includes("'extraction'") ? [["extractor", 1, 0, 0, 0, 1000]] : [["correction-only", 1, 10, 0, 0, 1000]] };
    return { rows: [] };
  });
  const lib = loadRoute<{ pilotMetrics(): Promise<{ byModel: { model: string; cleanPct: number | null }[] }> }>(new URL("../src/lib/metrics.ts", import.meta.url), {
    "server-only": {}, "@/db": { db }, "@/db/schema": schema, "./models": { activeModel: async () => "test" },
  });
  const result = await lib.pilotMetrics();
  assert.equal(result.byModel[0].model, "extractor");
  assert.equal(result.byModel[0].cleanPct, null);
});

for (const response of [new Error("Provider unavailable"), { text: "not-json", model: "test" }, { text: "{}", model: "test" }]) {
  it(`marks learning ${response instanceof Error ? "provider" : response.text === "{}" ? "invalid result" : "JSON"} failure as failed with retry context`, async () => {
    const writes: { sql: string; params: unknown[] }[] = [];
    const emitted: unknown[][] = [];
    const db = drizzle(async (sql, params) => {
      writes.push({ sql, params });
      return { rows: [{ insertId: 88, affectedRows: 1 }] };
    });
    const lib = loadRoute<{ learnFromCorrection(input: unknown): Promise<number | null> }>(new URL("../src/lib/learningAgent.ts", import.meta.url), {
      "server-only": {}, "@/db": { db }, "@/db/schema": schema,
      "./llm": { llmComplete: async () => { if (response instanceof Error) throw response; return response; } },
      "./models": { modelChain: async () => ["test"] },
      "./runEvents": { emit: async (...args: unknown[]) => { emitted.push(args); } },
    });
    assert.equal(await lib.learnFromCorrection({ sourceId: 7, communityId: 3, eventId: 41, reviewerId: 9, triggerKind: "edit", fieldName: "title", beforeValue: "a", afterValue: "b" }), null);
    const update = writes.find((q) => q.sql.startsWith("update `runs`"));
    assert.ok(update?.params.includes("failed"), "provider failure must not be completed");
    assert.ok(update?.params.some((p) => typeof p === "string" && p.includes('"eventId":41') && p.includes('"retryable":true')));
    assert.equal(writes.some((q) => q.sql.startsWith("insert into `learnings`")), false);
    assert.equal(emitted.some((args) => String(args[2]).includes("Nothing worth teaching")), false);
  });
}

it("keeps a genuine valid no-lesson decision completed", async () => {
  const updates: unknown[][] = [];
  const db = drizzle(async (sql, params) => { if (sql.startsWith("update")) updates.push(params); return { rows: [{ insertId: 88, affectedRows: 1 }] }; });
  const lib = loadRoute<{ learnFromCorrection(input: unknown): Promise<number | null> }>(new URL("../src/lib/learningAgent.ts", import.meta.url), {
    "server-only": {}, "@/db": { db }, "@/db/schema": schema,
    "./llm": { llmComplete: async () => ({ text: '{"lesson":"","scope":"source","worthKeeping":false}', model: "test" }) },
    "./models": { modelChain: async () => ["test"] }, "./runEvents": { emit: async () => {} },
  });
  assert.equal(await lib.learnFromCorrection({ sourceId: 7, communityId: 3, triggerKind: "edit" }), null);
  assert.ok(updates.some((p) => p.includes("completed")));
});
