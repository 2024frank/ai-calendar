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
  const recoveredJobs = await requeueStaleJobs();
  const reaped = await reapStaleRuns();
  const deleted = await sweepExpiredEvents();
  const expiredRateLimitsDeleted = await sweepRateLimitBuckets();

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
