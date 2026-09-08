import assert from "node:assert/strict";
import { it } from "node:test";
import { NextResponse } from "next/server";
import { loadRoute } from "./helpers/load-route";

function fixture(listDue = async () => [{ id: 1, communityId: 1 }, { id: 2, communityId: 1 }, { id: 3, communityId: 2 }]) {
  const enqueued: number[] = [];
  const background: (() => Promise<void>)[] = [];
  let dispatched = 0;
  const route = loadRoute<typeof import("../src/app/api/cron/route")>(new URL("../src/app/api/cron/route.ts", import.meta.url), {
    "next/server": { NextResponse, after: (work: () => Promise<void>) => background.push(work) },
    "@/lib/auth": { getSession: async () => ({ role: "platform_admin" }) },
    "@/lib/jobs": {
      requeueStaleJobs: async () => ({ requeued: 1, failed: 0, orphaned: 0, expired: 0 }),
      enqueueExtraction: async (sourceId: number) => {
        if (sourceId === 2) throw new Error("source deleted during scheduler tick");
        enqueued.push(sourceId);
        return { runId: sourceId * 10, jobId: sourceId * 100, deduplicated: false };
      },
    },
    "@/lib/rateLimit": { sweepRateLimitBuckets: async () => 0 },
    "@/lib/retention": {
      dueScheduledSources: listDue, reapStaleRuns: async () => 0, sweepExpiredEvents: async () => 0,
    },
    "@/lib/workerDispatch": { dispatchWorker: async () => { dispatched += 1; return true; } },
  });
  return {
    enqueued,
    run: () => route.POST(new Request("https://example.org/api/cron", { method: "POST" })),
    async dispatches() { for (const work of background) await work(); return dispatched; },
  };
}

it("continues scheduling and dispatches good jobs when one source fails to enqueue", async (t) => {
  t.mock.method(console, "error", () => {});
  const f = fixture();
  const response = await f.run();
  assert.deepEqual(f.enqueued, [1, 3]);
  // Two new jobs plus one recovered job: one chain each, so a dead chain
  // cannot leave the rest of the queue unclaimed.
  assert.equal(await f.dispatches(), 3);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.scheduledRunsStarted, 2);
  assert.deepEqual(body.failedSteps, ["enqueueExtraction:2"]);
});

it("dispatches recovered jobs even when the scheduled-source query fails", async (t) => {
  t.mock.method(console, "error", () => {});
  const f = fixture(async () => { throw new Error("source query unavailable"); });
  const response = await f.run();
  assert.equal(await f.dispatches(), 1);
  assert.equal(response.status, 503);
  assert.deepEqual((await response.json()).failedSteps, ["dueScheduledSources"]);
});

it("reads aggregator calendars after the organizations they repost", async () => {
  const f = fixture(async () => [
    { id: 1, communityId: 1, sourceKind: "aggregator" },
    { id: 3, communityId: 1, sourceKind: "original_org" },
    { id: 4, communityId: 1 },
  ]);
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.deepEqual(f.enqueued, [3, 4, 1]);
  assert.equal((await response.json()).workerChainsScheduled, 3);
});
