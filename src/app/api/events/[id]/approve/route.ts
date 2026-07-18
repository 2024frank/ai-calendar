import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { publishEvent } from "@/lib/publishEvent";

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

  // Approving means publishing: send it to the community's endpoint exactly
  // once. With no endpoint configured it simply stays in the AI calendar.
  const result = await publishEvent(ev.id);
  if (!result.ok && result.state !== "skipped") {
    return NextResponse.json(
      { ok: false, status: "approved", publish: result.state, error: result.message },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    status: result.state === "succeeded" ? "submitted" : "approved",
    publish: result.state,
    message: result.message,
  });
}
