import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { listSources } from "@/lib/data";
import { isPublicHttpUrl } from "@/lib/publicUrl";
import { valueToCron } from "@/lib/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || "source"
  );
}

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ sources: await listSources(s) });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (s.role !== "platform_admin" && s.role !== "community_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  // One source can publish across several pages (a listing plus its extra
  // pages, or a separate calendar). The first is the primary link.
  const urls: string[] = (Array.isArray(body.urls) ? body.urls : String(body.url ?? "").split(/[\n,]+/))
    .map((u: unknown) => String(u).trim())
    .filter(Boolean);
  const url = urls[0] ?? "";
  const specialInstructions = String(body.specialInstructions ?? "").trim() || null;
  const sourceType = body.sourceType === "email" ? "email" : "web";
  const scheduleCron = "schedule" in body ? valueToCron(String(body.schedule)) : null;
  const lookaheadRaw = Number(body.lookaheadDays);
  const lookaheadDays =
    Number.isInteger(lookaheadRaw) && lookaheadRaw >= 1 && lookaheadRaw <= 365 ? lookaheadRaw : null;
  const communityId =
    s.role === "platform_admin" ? Number(body.communityId) : (s.communityId ?? 0);

  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  if (!communityId) return NextResponse.json({ error: "A community is required." }, { status: 400 });
  if (sourceType === "web" && !url) {
    return NextResponse.json({ error: "A link is required for a web source." }, { status: 400 });
  }
  if (sourceType === "web" && urls.some((candidate) => !isPublicHttpUrl(candidate))) {
    return NextResponse.json(
      { error: "Source links must use a public http or https address." },
      { status: 400 },
    );
  }

  // Ensure a unique slug within the community.
  let slug = slugify(name);
  const [dup] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.communityId, communityId), eq(sources.slug, slug)))
    .limit(1);
  if (dup) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const [res] = await db.insert(sources).values({
    communityId,
    name,
    slug,
    sourceType,
    url: url || null,
    specialInstructions,
    // The setup wizard's research step replaces the Discovery Agent: pasted
    // instructions make the source immediately runnable.
    discoveryStatus: specialInstructions ? "ready" : "pending",
    startUrls: urls.length ? urls : null,
    scheduleCron,
    lookaheadDays,
  });

  const id = (res as { insertId: number }).insertId;

  const { logActivity } = await import("@/lib/activity");
  await logActivity({
    action: "source_added",
    actorUserId: s.uid,
    actorEmail: s.email,
    targetType: "source",
    targetId: id,
    summary: `Added source "${name}"`,
  });
  return NextResponse.json({ ok: true, id, slug });
}
