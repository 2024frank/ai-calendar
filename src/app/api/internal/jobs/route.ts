import { NextResponse } from "next/server";
import { drainJobs, queuedJobCount, requeueStaleJobs } from "@/lib/jobs";

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
  const recovered = await requeueStaleJobs();
  const drained = await drainJobs(Number.isFinite(requested) ? requested : 2);
  const remaining = await queuedJobCount();

  return NextResponse.json(
    { ok: true, recovered, drained, remaining },
    { headers: { "cache-control": "no-store" } },
  );
}

export const GET = POST;
