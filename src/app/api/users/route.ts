import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  communities,
  loginTokens,
  reviewerSources,
  sources,
  userCommunities,
  users,
} from "@/db/schema";
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
  // A person can be invited into several communities at once. The first is the
  // home community on the user row; the rest become memberships, which is what
  // puts the switcher in their sidebar. Older callers sending a single
  // communityId still work.
  const requested: number[] =
    s.role === "platform_admin"
      ? [
          ...new Set<number>(
            (Array.isArray(body.communityIds) ? body.communityIds : [body.communityId])
              .map((v: unknown) => Number(v))
              .filter((n: number) => Number.isInteger(n) && n > 0),
          ),
        ]
      : s.communityId
        ? [s.communityId]
        : [];
  const communityId = requested[0] ?? null;
  if (role !== "platform_admin" && !communityId) {
    return NextResponse.json({ error: "A community is required." }, { status: 400 });
  }

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // A non-platform admin must never touch a user from another community or a
  // platform admin, and must never relocate an existing user to their own
  // community. Otherwise inviting by a known email would hijack that account.
  if (existing && s.role !== "platform_admin") {
    if (existing.communityId !== s.communityId || existing.role === "platform_admin") {
      return NextResponse.json({ error: "That email belongs to another workspace." }, { status: 403 });
    }
  }

  let userId: number;
  if (existing) {
    const nextCommunity = s.role === "platform_admin" ? communityId : existing.communityId;
    await db
      .update(users)
      .set({
        name: name ?? existing.name,
        role: role as never,
        communityId: nextCommunity,
        canReviewAllSources: role !== "reviewer",
        status: "active",
      })
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

  // Everything past the home community is a membership row. Replaced outright
  // so re-inviting an existing person sets their access rather than adding to it.
  if (s.role === "platform_admin" && requested.length) {
    await db.delete(userCommunities).where(eq(userCommunities.userId, userId));
    const extra = requested.slice(1);
    if (extra.length) {
      await db
        .insert(userCommunities)
        .values(extra.map((cid) => ({ userId, communityId: cid })))
        .catch(() => undefined);
    }
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

  // Name every community they were given, so someone added to two is not told
  // about only one of them.
  let communityName = "AI Calendar";
  if (requested.length) {
    const rows = await db
      .select({ id: communities.id, name: communities.name })
      .from(communities)
      .where(inArray(communities.id, requested));
    const names = requested
      .map((id) => rows.find((r) => r.id === id)?.name)
      .filter(Boolean) as string[];
    if (names.length === 1) communityName = names[0];
    else if (names.length === 2) communityName = `${names[0]} and ${names[1]}`;
    else if (names.length > 2)
      communityName = `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  }
  const res = await sendInvite(email, link, communityName);

  return NextResponse.json({
    ok: true,
    userId,
    emailed: res.delivered,
    inviteLink: res.delivered ? undefined : link,
  });
}
