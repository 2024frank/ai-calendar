import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { events, learnings } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { publishEvent } from "@/lib/publishEvent";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ev = await getEventScoped(s, Number(id));
  if (!ev) return NextResponse.json({ error: "not found" }, { status: 404 });

  const wasRejected = ev.status === "rejected" || ev.status === "auto_rejected";

  // Publish FIRST, and only then call it approved.
  //
  // This used to mark the event approved before sending, and leave it that way
  // when the send failed. The reviewer saw it move to Approved, the tab counted
  // it, and nothing had reached CommunityHub. publishEvent sets the status
  // itself on success, so a failure now leaves the event exactly where it was,
  // still waiting, which is the truth.
  const result = await publishEvent(ev.id, "approved");

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: ev.status,
        publish: result.state,
        error: `${result.message} The event has NOT been approved and is still waiting.`,
      },
      { status: 502 },
    );
  }

  // Reached CommunityHub, or there is no endpoint and it simply lives here. A
  // reviewer's approval stays labelled "approved"; "submitted" is reserved for
  // the automatic path where nobody here read it.
  await db
    .update(events)
    .set({ status: "approved", publishedVia: "reviewer", rejectionReason: null })
    .where(eq(events.id, ev.id));

  // Approving something that was rejected reverses that judgement, so anything
  // taught by the rejection is withdrawn too. Otherwise the agents keep being
  // instructed by a decision the reviewer themselves took back, and the training
  // data carries a rule its own author no longer stands behind.
  if (wasRejected) {
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(learnings)
      .where(
        and(
          eq(learnings.eventId, ev.id),
          eq(learnings.triggerKind, "rejection"),
          eq(learnings.status, "active"),
        ),
      );
    if (Number(n)) {
      await db
        .update(learnings)
        .set({ status: "retired" })
        .where(and(eq(learnings.eventId, ev.id), eq(learnings.triggerKind, "rejection")));
      await logActivity({
        action: "edit",
        actorUserId: s.uid,
        actorEmail: s.email,
        targetType: "event",
        targetId: ev.id,
        summary: `Approved a rejected event, withdrawing ${n} lesson${Number(n) === 1 ? "" : "s"} taught by the rejection`,
      });
    }
  }

  await logActivity({
    action: "approve",
    actorUserId: s.uid,
    actorEmail: s.email,
    targetType: "event",
    targetId: ev.id,
    summary: `Approved "${(ev.title ?? "untitled").slice(0, 80)}"`,
    detail: { publish: result.state },
  });

  return NextResponse.json({
    ok: true,
    status: "approved",
    publish: result.state,
    message: result.message,
  });
}
