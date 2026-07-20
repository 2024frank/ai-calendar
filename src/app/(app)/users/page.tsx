import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { reviewerSources, users } from "@/db/schema";
import { isAdmin, requireUser } from "@/lib/auth";
import { listCommunities, listSources } from "@/lib/data";
import { UsersAdmin } from "./UsersAdmin";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const s = await requireUser();
  if (!isAdmin(s)) redirect("/dashboard");

  const rows =
    s.role === "platform_admin"
      ? await db.select().from(users).orderBy(users.id)
      : await db
          .select()
          .from(users)
          .where(eq(users.communityId, s.communityId ?? -1))
          .orderBy(users.id);

  const [comms, srcs] = await Promise.all([listCommunities(), listSources(s)]);

  // Each reviewer's current source assignments, so the editor shows what's on.
  const rsRows = rows.length
    ? await db
        .select({ userId: reviewerSources.userId, sourceId: reviewerSources.sourceId })
        .from(reviewerSources)
        .where(inArray(reviewerSources.userId, rows.map((u) => u.id)))
    : [];
  const assignedByUser = new Map<number, number[]>();
  for (const r of rsRows) {
    const arr = assignedByUser.get(r.userId) ?? [];
    arr.push(r.sourceId);
    assignedByUser.set(r.userId, arr);
  }

  return (
    <UsersAdmin
      users={rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        communityId: u.communityId,
        status: u.status,
        canReviewAllSources: u.canReviewAllSources,
        sourceIds: assignedByUser.get(u.id) ?? [],
      }))}
      communities={comms.map((c) => ({ id: c.id, name: c.name }))}
      sources={srcs.map((x) => ({ id: x.id, name: x.name }))}
      isPlatformAdmin={s.role === "platform_admin"}
      myCommunityId={s.communityId}
      myUserId={s.uid}
    />
  );
}
