import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
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

  return (
    <UsersAdmin
      users={rows.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        communityId: u.communityId,
        status: u.status,
      }))}
      communities={comms.map((c) => ({ id: c.id, name: c.name }))}
      sources={srcs.map((x) => ({ id: x.id, name: x.name }))}
      isPlatformAdmin={s.role === "platform_admin"}
      myCommunityId={s.communityId}
    />
  );
}
