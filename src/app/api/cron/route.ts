import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/auth";
import { drainJobs, enqueueExtraction, requeueStaleJobs } from "@/lib/jobs";
import { sweepRateLimitBuckets } from "@/lib/rateLimit";
import { dueScheduledSources, reapStaleRuns, sweepExpiredEvents } from "@/lib/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled maintenance tick. Vercel Cron calls this with the CRON_SECRET.
 * A platform admin may also trigger it from a signed-in session.
 * It (1) purges past-date unpublished events and (2) starts runs for any
 * scheduled source whose interval has elapsed.
 */
async function authorize(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth === `Bearer ${secret}`) return true;
  }
  const s = await getSession();
  return s?.role === "platform_admin";
}

export async function GET(req: Request) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
  // This keeps the current one-deployment setup responsive. The durable rows
  // remain safe if the invocation is terminated, and /api/internal/jobs can be
  // called by dedicated workers as traffic grows.
  after(async () => {
    await drainJobs(2);
  });

  return NextResponse.json({
    ok: true,
    staleRunsFailed: reaped,
    recoveredJobs,
    expiredDeleted: deleted,
    expiredRateLimitsDeleted,
    scheduledRunsStarted: started.length,
    started,
  });
}

// Vercel Cron issues GET; allow POST for manual/admin triggers too.
export const POST = GET;
