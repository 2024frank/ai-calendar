import { NextResponse, after } from "next/server";
import { getSession, isAdmin } from "@/lib/auth";
import { getSource } from "@/lib/data";
import { enqueueExtraction, processJob } from "@/lib/jobs";

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

  // No extraction until Discovery has produced a recipe for this source.
  if (source.discoveryStatus !== "ready" && source.discoveryStatus !== "stale") {
    return NextResponse.json(
      {
        error:
          source.discoveryStatus === "discovering"
            ? "Discovery is still running. Wait for it to finish before running."
            : "Run discovery first so the agent learns this source.",
      },
      { status: 409 },
    );
  }

  const { jobId, runId, deduplicated } = await enqueueExtraction(source.id, source.communityId);
  after(async () => {
    await processJob(jobId);
  });
  return NextResponse.json(
    { runId, jobId, deduplicated },
    { status: deduplicated ? 200 : 202 },
  );
}
