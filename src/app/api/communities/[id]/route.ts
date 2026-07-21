import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { flushCommunityInheritors, type FlushResult } from "@/lib/autoPublish";
import { logActivity } from "@/lib/activity";
import { MODE_LABELS, normalizeMode, type ReviewMode } from "@/lib/modeLabels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const communityId = Number(id);
  const allowed =
    s.role === "platform_admin" || (s.role === "community_admin" && s.communityId === communityId);
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  const nextMode = normalizeMode(body.defaultMode);
  if (nextMode) patch.defaultMode = nextMode;
  if (body.timezone) patch.timezone = String(body.timezone).slice(0, 64);
  if (body.name) patch.name = String(body.name).slice(0, 200);
  if ("defaultDestinationId" in body) {
    patch.defaultDestinationId = body.defaultDestinationId
      ? Number(body.defaultDestinationId)
      : null;
  }

  if (!Object.keys(patch).length) return NextResponse.json({ ok: true });
  await db.update(communities).set(patch).where(eq(communities.id, communityId));

  // Same rule as a single source: if the community default just became
  // unrestricted, the events waiting under every source that inherits it go out
  // now. Sources with their own explicit mode are untouched.
  let flushed: FlushResult | null = null;
  if (patch.defaultMode && patch.defaultMode !== "needs_approval") {
    flushed = await flushCommunityInheritors(communityId);
    if (flushed.published) {
      await logActivity({
        action: "approve",
        actorUserId: s.uid,
        actorEmail: s.email,
        targetType: "community",
        targetId: communityId,
        summary: `Set the community default to ${MODE_LABELS[patch.defaultMode as ReviewMode].name} and sent ${flushed.published} waiting event${flushed.published === 1 ? "" : "s"}`,
      });
    }
  }

  return NextResponse.json({ ok: true, flushed });
}
