import { cookies } from "next/headers";
import Image from "next/image";
import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { CommunitySwitcher } from "@/components/CommunitySwitcher";
import { AppShell } from "@/components/AppShell";
import { Icon, ThemeToggle } from "@/components/ui";
import { accessibleCommunities, activeCommunityId, pendingCount } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const chosen = Number((await cookies()).get("ac_community")?.value) || null;
  const [communities, activeId, pending] = await Promise.all([
    accessibleCommunities(session),
    activeCommunityId(session, chosen),
    pendingCount(session),
  ]);
  const displayName = session.name || session.email;
  const roleLabel = session.role.replace(/_/g, " ");

  const sidebar = (
    <aside className="side" id="app-sidebar" aria-label="Primary navigation">
      <div className="brand">
        <Image
          src="/brand/communityhub-wordmark.png"
          alt="CommunityHub"
          width={1662}
          height={255}
          priority
        />
        <div className="brand__product">AI Calendar</div>
      </div>
      <Nav role={session.role} pending={pending} />
      <CommunitySwitcher
        communities={communities.map((community) => ({ id: community.id, name: community.name }))}
        activeId={activeId}
      />
      <div className="side__spacer" />
      <div className="account-card">
        <div className="account-card__top">
          <span className="account-card__avatar" aria-hidden="true">
            {displayName.slice(0, 1).toUpperCase()}
          </span>
          <div className="account-card__copy">
            <strong>{displayName}</strong>
            <span>{roleLabel}</span>
          </div>
          <ThemeToggle />
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="account-card__signout" type="submit">
            <Icon name="logout" />
            Sign Out
          </button>
        </form>
      </div>
    </aside>
  );

  return <AppShell sidebar={sidebar}>{children}</AppShell>;
}
