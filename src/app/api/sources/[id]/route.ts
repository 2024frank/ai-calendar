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
      ? String(body.specialInstructions).slice(0, 32000)
      : null;
    // Saved instructions are the extraction recipe now (the wizard's research
    // step replaced the Discovery Agent), so the source becomes runnable.
    if (patch.specialInstructions) patch.discoveryStatus = "ready";
  }
  if ("name" in body && String(body.name).trim()) {
    patch.name = String(body.name).trim().slice(0, 200);
  }

  // Links: accept a list or a newline/comma string; the first is the primary.
  let linksChanged = false;
  if ("urls" in body || "url" in body) {
    const urls = (
      Array.isArray(body.urls) ? body.urls : String(body.url ?? "").split(/[\n,]+/)
    )
      .map((u: unknown) => String(u).trim())
      .filter(Boolean)
      .slice(0, 12);
    if (urls.length) {
      patch.url = urls[0].slice(0, 2048);
      patch.startUrls = urls;
      linksChanged = true;
    }
  }

  if ("destinationId" in body) {
    patch.destinationId = body.destinationId ? Number(body.destinationId) : null;
  }

  if (!Object.keys(patch).length) return NextResponse.json({ ok: true });

  // If the links changed, the saved extraction recipe may no longer fit, so mark
  // discovery pending. The caller can re-run discovery to rebuild it.
  if (linksChanged) patch.discoveryStatus = "pending";

  await db.update(sources).set(patch).where(eq(sources.id, source.id));
  return NextResponse.json({ ok: true, rediscover: linksChanged });
}
