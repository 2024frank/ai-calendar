import { NextResponse, after } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { sources } from "@/db/schema";
import { runDiscovery, startRun } from "@/lib/agent";
import { getSession } from "@/lib/auth";
import { listSources } from "@/lib/data";
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
  const urls = (Array.isArray(body.urls) ? body.urls : String(body.url ?? "").split(/[\n,]+/))
    .map((u: unknown) => String(u).trim())
    .filter(Boolean);
  const url = urls[0] ?? "";
  const specialInstructions = String(body.specialInstructions ?? "").trim() || null;
  const sourceType = body.sourceType === "email" ? "email" : "web";
  const scheduleCron = "schedule" in body ? valueToCron(String(body.schedule)) : null;
  const communityId =
    s.role === "platform_admin" ? Number(body.communityId) : (s.communityId ?? 0);

  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
  if (!communityId) return NextResponse.json({ error: "A community is required." }, { status: 400 });
  if (sourceType === "web" && !url) {
    return NextResponse.json({ error: "A link is required for a web source." }, { status: 400 });
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
    discoveryStatus: "pending",
    startUrls: urls.length ? urls : null,
    scheduleCron,
  });

  const id = (res as { insertId: number }).insertId;

  // A new source immediately gets probed by the Discovery Agent.
  let runId: number | null = null;
  if (sourceType === "web" && url) {
    await db.update(sources).set({ discoveryStatus: "discovering" }).where(eq(sources.id, id));
    runId = await startRun(id, communityId, "discovery");
    const rid = runId;
    after(async () => {
      await runDiscovery(rid);
    });
  }

  return NextResponse.json({ ok: true, id, slug, runId });
}
