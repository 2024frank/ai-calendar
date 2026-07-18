import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { runDiscovery, startRun } from "@/lib/agent";
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

  await db.update(sources).set({ discoveryStatus: "discovering" }).where(eq(sources.id, source.id));
  const runId = await startRun(source.id, source.communityId, "discovery");
  after(async () => {
    await runDiscovery(runId);
  });
  return NextResponse.json({ runId });
}
