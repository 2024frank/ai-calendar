import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { communities, loginTokens, reviewerSources, sources, users } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/auth";
import { sendInvite } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const rows =
    s.role === "platform_admin"
      ? await db.select().from(users).orderBy(users.id)
      : await db
          .select()
          .from(users)
          .where(eq(users.communityId, s.communityId ?? -1))
          .orderBy(users.id);

  return NextResponse.json({ users: rows });
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = body.name ? String(body.name).trim() : null;
  const role = String(body.role ?? "reviewer");
  const sourceIds: number[] = Array.isArray(body.sourceIds) ? body.sourceIds.map(Number) : [];

  if (!email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (!["platform_admin", "community_admin", "reviewer"].includes(role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }
  // A community admin cannot mint platform admins or reach other communities.
  if (s.role !== "platform_admin" && role === "platform_admin") {
    return NextResponse.json({ error: "Only a platform admin can do that." }, { status: 403 });
  }
  const communityId =
    s.role === "platform_admin"
      ? body.communityId
        ? Number(body.communityId)
        : null
      : (s.communityId ?? null);
  if (role !== "platform_admin" && !communityId) {
    return NextResponse.json({ error: "A community is required." }, { status: 400 });
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId: number;
  if (existing) {
    await db
      .update(users)
      .set({ name: name ?? existing.name, role: role as never, communityId, status: "active" })
      .where(eq(users.id, existing.id));
    userId = existing.id;
  } else {
    const [res] = await db.insert(users).values({
      email,
      name,
      role: role as never,
      communityId,
      canReviewAllSources: role !== "reviewer",
      status: "active",
    });
    userId = (res as { insertId: number }).insertId;
  }

  if (role === "reviewer" && sourceIds.length && communityId) {
    // Only assign sources that actually belong to this reviewer's community.
    const owned = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(inArray(sources.id, sourceIds), eq(sources.communityId, communityId)));
    const allowed = owned.map((r) => r.id);
    await db.delete(reviewerSources).where(eq(reviewerSources.userId, userId));
    if (allowed.length) {
      await db
        .insert(reviewerSources)
        .values(allowed.map((sid) => ({ userId, sourceId: sid })))
        .catch(() => undefined);
    }
  }

  // Mint a sign-in link so the invite works even before email is configured.
  const rawToken = randomBytes(32).toString("hex");
  await db.insert(loginTokens).values({
    userId,
    kind: "magic",
    tokenHash: createHash("sha256").update(rawToken).digest("hex"),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  const base = process.env.APP_URL || new URL(req.url).origin;
  const link = `${base}/set-password?token=${rawToken}`;

  let communityName = "AI Calendar";
  if (communityId) {
    const [c] = await db.select().from(communities).where(eq(communities.id, communityId)).limit(1);
    if (c) communityName = c.name;
  }
  const res = await sendInvite(email, link, communityName);

  return NextResponse.json({
    ok: true,
    userId,
    emailed: res.delivered,
    inviteLink: res.delivered ? undefined : link,
  });
}
