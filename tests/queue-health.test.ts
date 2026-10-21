import assert from "node:assert/strict";
import { it } from "node:test";
import { NextResponse } from "next/server";
import { queueHealthProblems } from "../src/lib/jobPolicy";
import { loadRoute } from "./helpers/load-route";

const MIN = 60;

it("treats an idle or busy-but-moving queue as healthy", () => {
  assert.deepEqual(queueHealthProblems({ queued: 0, running: 0, oldestQueuedSeconds: null, oldestRunningSeconds: null }), []);
  assert.deepEqual(queueHealthProblems({ queued: 8, running: 2, oldestQueuedSeconds: 40 * MIN, oldestRunningSeconds: 6 * MIN }), []);
});

it("flags jobs left unclaimed or leases that recovery has not cleared", () => {
  assert.equal(queueHealthProblems({ queued: 1, running: 0, oldestQueuedSeconds: 100 * MIN, oldestRunningSeconds: null }).length, 1);
  assert.equal(queueHealthProblems({ queued: 0, running: 1, oldestQueuedSeconds: null, oldestRunningSeconds: 31 * MIN }).length, 1);
});

function route(row: Record<string, unknown>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    where: async () => [row],
  };
  return loadRoute<typeof import("../src/app/api/internal/jobs/health/route")>(
    new URL("../src/app/api/internal/jobs/health/route.ts", import.meta.url),
    {
      "next/server": { NextResponse },
      "@/db": { db: chain },
      "@/db/schema": { jobs: {} },
      "drizzle-orm": { inArray: () => null, sql: () => null },
      "@/lib/jobPolicy": { queueHealthProblems },
      "@/lib/workerAuth": { authorizedWorkerBearer: (h: string | null) => h === "Bearer ok" },
    },
  );
}

it("health route rejects callers without a worker bearer", async () => {
  const r = route({});
  assert.equal((await r.GET(new Request("https://x.test/h"))).status, 401);
});

it("health route reports 503 with counters only when the queue is stuck", async () => {
  const stuck = route({ queued: "3", running: "0", oldestQueued: "7200", oldestRunning: null });
  const res = await stuck.GET(new Request("https://x.test/h", { headers: { authorization: "Bearer ok" } }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.queued, 3);
  const fine = route({ queued: "1", running: "1", oldestQueued: "60", oldestRunning: "30" });
  assert.equal((await fine.GET(new Request("https://x.test/h", { headers: { authorization: "Bearer ok" } }))).status, 200);
});
