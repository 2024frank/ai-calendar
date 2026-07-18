import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/auth";
import { getSource } from "@/lib/data";
import { valueToCron } from "@/lib/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const source = await getSource(s, Number(id));
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if ("mode" in body) {
    const m = body.mode;
    patch.mode = m === "restricted" || m === "unrestricted" ? m : null; // null = inherit
  }
  if ("active" in body) patch.active = Boolean(body.active);
  if ("schedule" in body) patch.scheduleCron = valueToCron(String(body.schedule));
  if ("specialInstructions" in body) {
    patch.specialInstructions = body.specialInstructions
      ? String(body.specialInstructions).slice(0, 4000)
      : null;
  }
  if ("url" in body && body.url) patch.url = String(body.url).slice(0, 2048);
  if ("destinationId" in body) {
    patch.destinationId = body.destinationId ? Number(body.destinationId) : null;
  }

  if (!Object.keys(patch).length) return NextResponse.json({ ok: true });
  await db.update(sources).set(patch).where(eq(sources.id, source.id));
  return NextResponse.json({ ok: true });
}
