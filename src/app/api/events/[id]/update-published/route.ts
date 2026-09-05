import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { publishUpdate } from "@/lib/publishUpdate";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const eventId = Number((await params).id);
  if (!Number.isSafeInteger(eventId) || eventId < 1) return NextResponse.json({ error: "not found" }, { status: 404 });
  const event = await getEventScoped(session, eventId);
  if (!event) return NextResponse.json({ error: "not found" }, { status: 404 });
  // The body is deliberately unused: the server owns content, destination and
  // remote id. Saving edits and sending them are separate reviewer commands.
  const result = await publishUpdate(event.id);
  await logActivity({
    action: "edit", actorUserId: session.uid, actorEmail: session.email,
    targetType: "event", targetId: event.id, summary: result.message.slice(0,300),
    detail: { command: "update_published", state: result.state, remoteId: result.remoteId ?? null },
  });
  return NextResponse.json({ ...result, publish: result.state, status: event.status, ...(!result.ok ? { error: result.message } : {}) }, {
    status: result.ok ? 200 : result.state === "failed" ? 502 : 409,
  });
}
