import { NextResponse } from "next/server";

import { logActivity } from "@/lib/activity";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { resolveProposal } from "@/lib/proposalResolution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/events/:id/resolve-proposal
 *
 * Marks proposal bookkeeping complete. It deliberately has no rejection or
 * learning side effects: resolving a proposal says nothing about future source
 * events and does not exclude them from later extraction.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const eventId = Number((await params).id);
  if (!Number.isSafeInteger(eventId) || eventId < 1) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const event = await getEventScoped(session, eventId);
  if (!event) return NextResponse.json({ error: "not found" }, { status: 404 });

  const result = await resolveProposal(event.id, event.communityId);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 409 });
  }

  if (!result.alreadyResolved) {
    await logActivity({
      action: "edit",
      actorUserId: session.uid,
      actorEmail: session.email,
      targetType: "event",
      targetId: event.id,
      summary: `Marked recurrence update proposal #${event.id} resolved for event #${result.originalEventId}`,
      detail: {
        command: "resolve_proposal",
        originalEventId: result.originalEventId,
        proposalResolvedAt: result.proposalResolvedAt,
      },
    });
  }

  return NextResponse.json(result);
}
