import { NextResponse, after } from "next/server";
import { runExtraction, startRun } from "@/lib/agent";
import { getSession } from "@/lib/auth";
import { dueScheduledSources, sweepExpiredEvents } from "@/lib/retention";

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

  const deleted = await sweepExpiredEvents();

  const due = await dueScheduledSources();
  const started: { sourceId: number; runId: number }[] = [];
  for (const s of due) {
    const runId = await startRun(s.id, s.communityId, "extraction");
    started.push({ sourceId: s.id, runId });
    after(async () => {
      await runExtraction(runId);
    });
  }

  return NextResponse.json({
    ok: true,
    expiredDeleted: deleted,
    scheduledRunsStarted: started.length,
    started,
  });
}

// Vercel Cron issues GET; allow POST for manual/admin triggers too.
export const POST = GET;
