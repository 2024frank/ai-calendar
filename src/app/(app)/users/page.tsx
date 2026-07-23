import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { userCommunities, users } from "@/db/schema";
import { isAdmin, requireUser } from "@/lib/auth";
import { accessibleCommunities } from "@/lib/data";
import { UsersAdmin } from "./UsersAdmin";

export const dynamic = "force-dynamic";

const userFields = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  communityId: users.communityId,
  status: users.status,
};

export default async function UsersPage() {
  const s = await requireUser();
  if (!isAdmin(s)) redirect("/dashboard");

  const rows =
    s.role === "platform_admin"
      ? await db.select(userFields).from(users).orderBy(users.id)
      : await db
          .select(userFields)
          .from(users)
          .where(eq(users.communityId, s.communityId ?? -1))
          .orderBy(users.id);

  const comms = await accessibleCommunities(s);

  // Each user's extra community memberships, so the editor shows every community
  // they can reach (home community + extras). Belonging to more than one is what
  // gives them the community switcher.
  const ucRows = rows.length
    ? await db
        .select({ userId: userCommunities.userId, communityId: userCommunities.communityId })
        .from(userCommunities)
        .where(inArray(userCommunities.userId, rows.map((u) => u.id)))
    : [];
  const extraByUser = new Map<number, number[]>();
  for (const r of ucRows) {
    const arr = extraByUser.get(r.userId) ?? [];
    arr.push(r.communityId);
    extraByUser.set(r.userId, arr);
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
        // Home community first, then the extra memberships, de-duplicated.
        communityIds: [...new Set([u.communityId, ...(extraByUser.get(u.id) ?? [])].filter(Boolean))] as number[],
      }))}
      communities={comms.map((c) => ({ id: c.id, name: c.name }))}
      isPlatformAdmin={s.role === "platform_admin"}
      myCommunityId={s.communityId}
      myUserId={s.uid}
    />
  );
}
