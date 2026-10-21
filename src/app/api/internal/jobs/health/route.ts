import { NextResponse } from "next/server";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { queueHealthProblems } from "@/lib/jobPolicy";
import { authorizedWorkerBearer } from "@/lib/workerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const count = (value: unknown) => Number(value ?? 0);
const seconds = (value: unknown) => (value == null ? null : Math.max(0, Number(value)));

/**
 * Queue heartbeat for the scheduler. Returns 200 while the queue is moving and
 * 503 when a job has waited unclaimed, or held a lease, past the alert
 * thresholds, so an external caller can turn "work is stuck" into a failure.
 * Counters only: it never returns source names, URLs, or event content.
 */
export async function GET(req: Request) {
  if (!authorizedWorkerBearer(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [row] = await db
    .select({
      queued: sql<number>`coalesce(sum(${jobs.status} = 'queued'), 0)`,
      running: sql<number>`coalesce(sum(${jobs.status} = 'running'), 0)`,
      oldestQueued: sql<number | null>`timestampdiff(second, min(case when ${jobs.status} = 'queued' then ${jobs.availableAt} end), now())`,
      oldestRunning: sql<number | null>`timestampdiff(second, min(case when ${jobs.status} = 'running' then ${jobs.lockedAt} end), now())`,
    })
    .from(jobs)
    .where(inArray(jobs.status, ["queued", "running"]));

  const health = {
    queued: count(row?.queued),
    running: count(row?.running),
    oldestQueuedSeconds: seconds(row?.oldestQueued),
    oldestRunningSeconds: seconds(row?.oldestRunning),
  };
  const problems = queueHealthProblems(health);
  return NextResponse.json(
    { ok: problems.length === 0, problems, ...health },
    { status: problems.length ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
