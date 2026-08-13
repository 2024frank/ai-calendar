import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/auth";
import { enqueueExtraction, requeueStaleJobs } from "@/lib/jobs";
import { sweepRateLimitBuckets } from "@/lib/rateLimit";
import { dueScheduledSources, reapStaleRuns, sweepExpiredEvents } from "@/lib/retention";
import { dispatchWorker } from "@/lib/workerDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled maintenance tick. Vercel Cron calls this with the CRON_SECRET.
 * A platform admin may also trigger it from a signed-in session.
 * It (1) purges past-date unpublished events and (2) starts runs for any
 * scheduled source whose interval has elapsed.
 */
function hasCronBearer(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && req.headers.get("authorization") === `Bearer ${secret}`);
}

async function authorizePost(req: Request): Promise<boolean> {
  if (hasCronBearer(req)) return true;
  const s = await getSession();
  return s?.role === "platform_admin";
}

async function runCron(requestOrigin: string) {
  // Each maintenance step stands on its own. They used to run unguarded in a
  // row, so a throw in either of the first two would have taken the whole tick
  // down and silently skipped the expiry sweep behind them. One failing chore
  // should never cost the others their turn.
  const step = async <T,>(name: string, work: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      console.error(`Cron step failed: ${name}`, {
        message: error instanceof Error ? error.message : "unknown error",
      });
      return fallback;
    }
  };

  const recoveredJobs = await step("requeueStaleJobs", requeueStaleJobs, {
    requeued: 0,
    failed: 0,
    orphaned: 0,
    expired: 0,
  });
  const reaped = await step("reapStaleRuns", reapStaleRuns, 0);
  const deleted = await step("sweepExpiredEvents", sweepExpiredEvents, 0);
  const expiredRateLimitsDeleted = await step("sweepRateLimitBuckets", sweepRateLimitBuckets, 0);

  // The hosting plan allows a single daily cron, so this one tick starts every
  // source that is due. Each run is still bounded by the platform's per-request
  // limit; a source that needs longer is run manually until that limit lifts.
  const due = await dueScheduledSources();
  const started: { sourceId: number; runId: number; jobId: number; deduplicated: boolean }[] = [];
  for (const s of due) {
    const queued = await enqueueExtraction(s.id, s.communityId);
    started.push({ sourceId: s.id, ...queued });
  }
  // Start a sequential serverless worker chain. Each extraction gets its own
  // invocation and the final worker dispatches the next, so all due sources are
  // serviced without running a dozen model jobs in one function.
  after(async () => {
    // Dispatch against the public app origin, never this request's own origin.
    // Vercel invokes the cron on the deployment's generated URL, which sits
    // behind deployment protection; the cron itself is let through, but a fetch
    // back to that origin is not, so the worker kick-off died with a 401 every
    // morning and every job aged out unclaimed ("No worker claimed this job").
    const publicOrigin = process.env.APP_URL
      ? new URL(process.env.APP_URL).origin
      : requestOrigin;
    const dispatched = await dispatchWorker(0, publicOrigin);
    if (!dispatched) console.error("Cron could not start the job worker", { publicOrigin });
  });

  return NextResponse.json({
    ok: true,
    staleRunsFailed: reaped,
    recoveredJobs,
    expiredDeleted: deleted,
    expiredRateLimitsDeleted,
    scheduledRunsStarted: started.length,
    workerDispatchScheduled: true,
    started,
  });
}

// Vercel Cron issues GET. GET mutates state, so it is bearer-only and can never
// be triggered by luring a signed-in admin to a cross-site link.
export async function GET(req: Request) {
  if (!hasCronBearer(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runCron(new URL(req.url).origin);
}

// Interactive admin runs use POST and therefore pass the proxy's Origin check.
export async function POST(req: Request) {
  if (!(await authorizePost(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runCron(new URL(req.url).origin);
}
