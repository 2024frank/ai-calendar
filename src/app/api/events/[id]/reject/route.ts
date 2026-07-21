import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { logActivity } from "@/lib/activity";
import { recordRejection } from "@/lib/learning";
import { learnFromCorrection } from "@/lib/learningAgent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ev = await getEventScoped(s, Number(id));
  if (!ev) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const reasonCode = String(body.reasonCode ?? "other");
  const note = body.note ? String(body.note).slice(0, 1000) : null;

  await db
    .update(events)
    .set({ status: "rejected", rejectionReason: note ?? reasonCode })
    .where(eq(events.id, ev.id));

  // This is what teaches the next run.
  await recordRejection(ev.id, ev.sourceId, reasonCode, note, s.uid);
  after(async () => {
    await learnFromCorrection({
      eventId: ev.id,
      sourceId: ev.sourceId,
      communityId: ev.communityId,
      reviewerId: s.uid,
      triggerKind: "rejection",
      reason: note ? `${reasonCode}: ${note}` : reasonCode,
      title: ev.title,
    }).catch(() => undefined);
  });
  await logActivity({
    action: "reject",
    actorUserId: s.uid,
    actorEmail: s.email,
    targetType: "event",
    targetId: ev.id,
    summary: `Rejected "${(ev.title ?? "untitled").slice(0, 70)}" (${reasonCode})`,
    detail: { reasonCode, note },
  });

  return NextResponse.json({ ok: true, status: "rejected" });
}
