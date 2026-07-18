import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { runs } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { listRunEvents } from "@/lib/runEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const runId = Number(id);
  const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (s.role !== "platform_admin" && run.communityId !== s.communityId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const after = Number(new URL(req.url).searchParams.get("after") ?? 0);
  const evts = await listRunEvents(runId, after);
  const terminal = run.status !== "running";

  return NextResponse.json({
    events: evts,
    nextAfter: evts.length ? evts[evts.length - 1].id : after,
    status: run.status,
    phase: run.phase,
    terminal,
    tokens: { prompt: run.promptTokens, completion: run.completionTokens },
    counts: {
      found: run.eventsFound,
      inserted: run.eventsExtracted,
      duplicate: run.eventsDuplicate,
      invalid: run.eventsInvalid,
    },
  });
}
