import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/auth";
import { getSource } from "@/lib/data";
import { valueToCron } from "@/lib/schedule";
import { flushSourceIfUnrestricted, type FlushResult } from "@/lib/autoPublish";
import { logActivity } from "@/lib/activity";
import { MODE_LABELS, normalizeMode } from "@/lib/modeLabels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    // null means "follow the community default".
    patch.mode = normalizeMode(body.mode);
  }
  if ("active" in body) patch.active = Boolean(body.active);
  if ("schedule" in body) patch.scheduleCron = valueToCron(String(body.schedule));
  if ("lookaheadDays" in body) {
    const n = Number(body.lookaheadDays);
    patch.lookaheadDays = Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
  }
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

  // Turning review off is a decision about this source, not just about its next
  // run, so the events already queued behind it go out too. Reported back so
  // the settings panel can say how many were sent.
  let flushed: FlushResult | null = null;
  if ("mode" in body) {
    flushed = await flushSourceIfUnrestricted(source.id);
    if (flushed.published) {
      await logActivity({
        action: "approve",
        actorUserId: s.uid,
        actorEmail: s.email,
        targetType: "source",
        targetId: source.id,
        summary: `Set ${source.name} to ${MODE_LABELS[(normalizeMode(patch.mode as string) ?? "needs_approval")].name} and sent ${flushed.published} waiting event${flushed.published === 1 ? "" : "s"}`,
      });
    }
  }

  return NextResponse.json({ ok: true, rediscover: linksChanged, flushed });
}
