import { NextResponse } from "next/server";
import { exportLearnings } from "@/lib/learningAgent";
import { getSession, isAdmin } from "@/lib/auth";
import { currentCommunityId } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The corrections corpus, as JSONL, one record per line.
 *
 * This is the point of keeping them. Each record holds what the agent produced,
 * what a person changed it to or why they refused it, and the instruction drawn
 * from that, which is the shape a local model can be trained on later.
 *
 * ?format=json returns one array instead, for reading rather than training.
 * ?scope=all takes every community; the default is the one you are working in.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const everyCommunity = url.searchParams.get("scope") === "all" && s.role === "platform_admin";
  const communityId = everyCommunity ? null : await currentCommunityId(s);

  const rows = await exportLearnings(communityId);

  const records = rows.map((r) => ({
    id: r.id,
    learned_at: r.createdAt,
    trigger: r.triggerKind,
    scope: r.scope,
    source_id: r.sourceId,
    community_id: r.communityId,
    event_id: r.eventId,
    field: r.fieldName,
    agent_produced: r.beforeValue,
    human_corrected_to: r.afterValue,
    human_reason: r.reason,
    lesson: r.lesson,
    written_by_model: r.model,
    times_served_to_agents: r.timesServed,
    status: r.status,
  }));

  if (url.searchParams.get("format") === "json") {
    return NextResponse.json({ count: records.length, records });
  }

  const jsonl = records.map((r) => JSON.stringify(r)).join("\n");
  return new Response(jsonl, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="corrections-${records.length}.jsonl"`,
    },
  });
}
