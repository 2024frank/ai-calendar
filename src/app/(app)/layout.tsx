import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
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

  const brand = (
    <Link className="topbar__brand" href="/dashboard" aria-label="CommunityHub AI Calendar — dashboard">
      <Image src="/brand/communityhub-wordmark.png" alt="CommunityHub" width={1662} height={255} priority />
      <span className="topbar__product">AI Calendar</span>
    </Link>
  );

  const nav = <Nav key={`${activeId ?? "none"}:${pending}`} role={session.role} pending={pending} />;

  const tools = (
    <div className="topbar__tools">
      <CommunitySwitcher
        communities={communities.map((community) => ({ id: community.id, name: community.name }))}
        activeId={activeId}
      />
      <div className="topbar__account">
        <span className="topbar__avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
        <span className="topbar__account-copy">
          <strong>{displayName}</strong>
          <span>{roleLabel}</span>
        </span>
        <ThemeToggle />
        <form action="/api/auth/logout" method="post">
          <button className="topbar__signout" type="submit">
            <Icon name="logout" />
            Sign Out
          </button>
        </form>
      </div>
    </div>
  );

  return <AppShell brand={brand} nav={nav} tools={tools}>{children}</AppShell>;
}
