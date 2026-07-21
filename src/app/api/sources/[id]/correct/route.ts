import { NextResponse, after } from "next/server";
import { startRun } from "@/lib/agent";
import { runCorrection } from "@/lib/correction";
import { getSession, isAdmin } from "@/lib/auth";
import { getSource } from "@/lib/data";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Run the correction agent over this source's auto-rejected events. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const source = await getSource(s, Number(id));
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });

  const runId = await startRun(source.id, source.communityId, "correction");
  await logActivity({
    action: "source_added",
    actorUserId: s.uid,
    actorEmail: s.email,
    targetType: "source",
    targetId: source.id,
    summary: `Started a correction pass on "${source.name}"`,
  });
  after(async () => {
    await runCorrection(runId, source.id).catch(() => undefined);
  });
  return NextResponse.json({ runId });
}
