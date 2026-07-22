import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { learnings } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retire or restore one lesson.
 *
 * A lesson is a judgement, and judgements get reversed. Retired lessons stop
 * being given to agents and are marked in the export; nothing is deleted, so
 * the record of what was once taught survives.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s || !isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { status?: string };
  const status = body.status === "retired" ? "retired" : body.status === "active" ? "active" : null;
  if (!status) return NextResponse.json({ error: "status must be active or retired" }, { status: 400 });

  const [row] = await db.select().from(learnings).where(eq(learnings.id, Number(id))).limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  await db.update(learnings).set({ status }).where(eq(learnings.id, row.id));
  await logActivity({
    action: "edit",
    actorUserId: s.uid,
    actorEmail: s.email,
    targetType: "learning",
    targetId: row.id,
    summary: `${status === "retired" ? "Retired" : "Restored"} the lesson: ${row.lesson.slice(0, 90)}`,
  });
  return NextResponse.json({ ok: true, status });
}
