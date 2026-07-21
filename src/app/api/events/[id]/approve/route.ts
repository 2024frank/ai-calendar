import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
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

  await db
    .update(events)
    .set({ status: "approved", publishedVia: "reviewer", rejectionReason: null })
    .where(eq(events.id, ev.id));

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
