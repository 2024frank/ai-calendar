import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities } from "@/db/schema";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (body.defaultMode === "restricted" || body.defaultMode === "unrestricted") {
    patch.defaultMode = body.defaultMode;
  }
  if (body.timezone) patch.timezone = String(body.timezone).slice(0, 64);
  if (body.name) patch.name = String(body.name).slice(0, 200);
  if ("defaultDestinationId" in body) {
    patch.defaultDestinationId = body.defaultDestinationId
      ? Number(body.defaultDestinationId)
      : null;
  }

  if (!Object.keys(patch).length) return NextResponse.json({ ok: true });
  await db.update(communities).set(patch).where(eq(communities.id, communityId));
  return NextResponse.json({ ok: true });
}
