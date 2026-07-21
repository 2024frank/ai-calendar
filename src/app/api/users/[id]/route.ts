import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { reviewerSources, sources, userCommunities, users } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Load the target user and check the caller may manage them. */
async function loadTarget(id: number, s: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) return { error: "not found", status: 404 as const };
  // A non-platform admin may only manage reviewers/admins inside their own
  // community, never a platform admin.
  if (s.role !== "platform_admin") {
    if (target.role === "platform_admin" || target.communityId !== s.communityId) {
      return { error: "That user belongs to another workspace.", status: 403 as const };
    }
  }
  return { target };
}

/** Edit a user's access: role, review-all flag, assigned sources, community, status. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const uid = Number(id);
  const loaded = await loadTarget(uid, s);
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const target = loaded.target;

  const body = (await req.json().catch(() => ({}))) as {
    role?: string;
    canReviewAllSources?: boolean;
    sourceIds?: number[];
    communityId?: number;
    communityIds?: number[];
    status?: string;
  };
  const patch: Record<string, unknown> = {};

  if (body.role !== undefined && String(body.role) !== target.role) {
    const role = String(body.role);
    if (!["platform_admin", "community_admin", "reviewer"].includes(role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    if (s.role !== "platform_admin" && role === "platform_admin") {
      return NextResponse.json({ error: "Only a platform admin can do that." }, { status: 403 });
    }
    // You cannot change your own role: it is how admins avoid locking themselves out.
    if (uid === s.uid) {
      return NextResponse.json({ error: "You cannot change your own role." }, { status: 400 });
    }
    patch.role = role;
    // An admin reviews everything; a reviewer is scoped unless review-all is set.
    if (role !== "reviewer") patch.canReviewAllSources = true;
  }
  if (body.canReviewAllSources !== undefined) {
    patch.canReviewAllSources = Boolean(body.canReviewAllSources);
  }
  if (body.status === "active" || body.status === "disabled") patch.status = body.status;

  // Community membership. Only a platform admin can move users across communities.
  // A list of communities is what lets a reviewer switch between them: the first
  // is their home community, the rest are extra memberships.
  let newCommunityIds: number[] | null = null;
  if (s.role === "platform_admin" && Array.isArray(body.communityIds)) {
    newCommunityIds = [...new Set(body.communityIds.map(Number).filter(Boolean))];
    if (newCommunityIds.length) patch.communityId = newCommunityIds[0];
  } else if (s.role === "platform_admin" && body.communityId !== undefined) {
    patch.communityId = body.communityId ? Number(body.communityId) : null;
  }

  if (Object.keys(patch).length) {
    await db.update(users).set(patch).where(eq(users.id, uid));
  }

  // Replace the extra memberships (everything past the home community).
  if (newCommunityIds) {
    await db.delete(userCommunities).where(eq(userCommunities.userId, uid));
    const extra = newCommunityIds.slice(1);
    if (extra.length) {
      await db
        .insert(userCommunities)
        .values(extra.map((cid) => ({ userId: uid, communityId: cid })))
        .catch(() => undefined);
    }
  }

  // Replace the reviewer's source assignments when a list is provided.
  if (Array.isArray(body.sourceIds)) {
    const communityId = (patch.communityId as number) ?? target.communityId;
    const owned = communityId
      ? await db
          .select({ id: sources.id })
          .from(sources)
          .where(and(inArray(sources.id, body.sourceIds.map(Number)), eq(sources.communityId, communityId)))
      : [];
    await db.delete(reviewerSources).where(eq(reviewerSources.userId, uid));
    if (owned.length) {
      await db
        .insert(reviewerSources)
        .values(owned.map((o) => ({ userId: uid, sourceId: o.id })))
        .catch(() => undefined);
    }
  }

  return NextResponse.json({ ok: true });
}

/** Remove a user entirely (cascades their source assignments and tokens). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(s)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const uid = Number(id);
  if (uid === s.uid) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }
  const loaded = await loadTarget(uid, s);
  if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status });

  await db.delete(users).where(eq(users.id, uid));
  return NextResponse.json({ ok: true });
}
