import { NextResponse, after } from "next/server";
import { runExtraction, startRun } from "@/lib/agent";
import { getSession, isAdmin } from "@/lib/auth";
import { getSource } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const source = await getSource(s, Number(id));
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });

  const runId = await startRun(source.id, source.communityId, "extraction");
  after(async () => {
    await runExtraction(runId);
  });
  return NextResponse.json({ runId });
}
