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

  await db
    .update(events)
    .set({ status: "approved", publishedVia: "reviewer", rejectionReason: null })
    .where(eq(events.id, ev.id));

  // Approving something that was rejected reverses that judgement, so anything
  // taught by the rejection is withdrawn too. Otherwise the agents keep being
  // instructed by a decision the reviewer themselves took back, and the
  // training data carries a lesson its own author no longer stands behind.
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

  // A reviewer approving in restricted mode both publishes to CommunityHub AND
  // keeps the event labelled "approved" (it belongs in the Approved tab, because
  // a human approved it). "submitted" is reserved for the unrestricted auto path.
  const result = await publishEvent(ev.id, "approved");
  if (!result.ok && result.state !== "skipped") {
    return NextResponse.json(
      { ok: false, status: "approved", publish: result.state, error: result.message },
      { status: 502 },
    );
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
