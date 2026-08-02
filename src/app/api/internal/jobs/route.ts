import { NextResponse, after } from "next/server";
import { drainJobs, queuedJobCount, requeueStaleJobs } from "@/lib/jobs";
import {
  nextWorkerRecoveryAttempt,
  shouldContinueWorkerChain,
  workerRecoveryAttempt,
} from "@/lib/jobPolicy";
import { dispatchWorker } from "@/lib/workerDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request) {
  const expected = process.env.WORKER_SECRET || process.env.CRON_SECRET;
  return Boolean(expected && req.headers.get("authorization") === `Bearer ${expected}`);
}

/** Private worker entrypoint. Safe to invoke concurrently from multiple workers. */
export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const requested = Number(new URL(req.url).searchParams.get("limit") ?? 2);
  const requestOrigin = new URL(req.url).origin;
  const chained = req.headers.get("x-ai-calendar-worker-chain") === "1";
  const recoveryAttempt = workerRecoveryAttempt(
    req.headers.get("x-ai-calendar-worker-recovery"),
  );

  if (chained) {
    after(async () => {
      try {
        await requeueStaleJobs();
        const drained = await drainJobs(1);
        const remaining = await queuedJobCount();
        if (shouldContinueWorkerChain(drained.considered, remaining)) {
          const dispatched = await dispatchWorker(0, requestOrigin);
          if (!dispatched) throw new Error("worker redispatch failed");
        }
      } catch (error) {
        const nextAttempt = nextWorkerRecoveryAttempt(recoveryAttempt);
        console.error("Worker chain step failed", {
          recoveryAttempt,
          message: error instanceof Error ? error.message : "unknown error",
        });
        if (nextAttempt != null) {
          const recovered = await dispatchWorker(nextAttempt, requestOrigin);
          if (!recovered) {
            console.error("Worker chain recovery dispatch failed", { nextAttempt });
          }
        }
      }
    });
    return NextResponse.json(
      { ok: true, accepted: true },
      { status: 202, headers: { "cache-control": "no-store" } },
    );
  }

  const recovered = await requeueStaleJobs();
  const drained = await drainJobs(Number.isFinite(requested) ? requested : 2);
  const remaining = await queuedJobCount();

  return NextResponse.json(
    { ok: true, recovered, drained, remaining },
    { headers: { "cache-control": "no-store" } },
  );
}

export const GET = POST;
