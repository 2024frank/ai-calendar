import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, destinations } from "@/db/schema";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Configure a community's publishing endpoint from just its CommunityHub base
 * URL. Everything else (submit, inventory, post-link paths) follows the same
 * CommunityHub pattern, so making a new community ready is: paste its hub URL,
 * turn it on, add sources.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const communityId = Number(id);
  const allowed =
    s.role === "platform_admin" || (s.role === "community_admin" && s.communityId === communityId);
  if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    apiBase?: string;
    active?: boolean;
  };

  const apiBase = String(body.apiBase ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(apiBase)) {
    return NextResponse.json({ error: "Enter the endpoint's base URL, like https://cleveland.communityhub.cloud" }, { status: 400 });
  }
  const name = String(body.name ?? "").trim() || `${new URL(apiBase).hostname} endpoint`;
  const active = Boolean(body.active);

  // The standard CommunityHub paths, derived from the base URL.
  const config = {
    api_base: apiBase,
    submit_url: `${apiBase}/api/legacy/calendar/post/submit`,
    patch_url_tmpl: `${apiBase}/api/legacy/calendar/post/{id}/submit`,
    inventory_url: `${apiBase}/api/legacy/calendar/posts?limit=10000&page=0&filter=future&tab=main-feed&isJobs=false&order=ASC&postType=All&allPosts`,
  };

  // One endpoint per community: update the existing row, or create it.
  const [existing] = await db
    .select({ id: destinations.id })
    .from(destinations)
    .where(eq(destinations.communityId, communityId))
    .limit(1);

  let destId: number;
  if (existing) {
    await db
      .update(destinations)
      .set({ name, type: "communityhub", config, active })
      .where(eq(destinations.id, existing.id));
    destId = existing.id;
  } else {
    const [res] = await db
      .insert(destinations)
      .values({ communityId, name, type: "communityhub", config, active });
    destId = (res as { insertId: number }).insertId;
  }

  // An active endpoint becomes the community's default publish target.
  await db
    .update(communities)
    .set({ defaultDestinationId: active ? destId : null })
    .where(eq(communities.id, communityId));

  return NextResponse.json({ ok: true, destinationId: destId, active });
}
