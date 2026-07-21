"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/ui";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/review", label: "Review Queue", icon: "review" },
  { href: "/sources", label: "Sources", icon: "sources", adminOnly: true },
  { href: "/users", label: "Users", icon: "users", adminOnly: true },
  { href: "/communities", label: "Communities", icon: "communities", platformOnly: true },
  { href: "/metrics", label: "Pilot Metrics", icon: "metrics", platformOnly: true },
] as const;

export function Nav({ role, pending = 0 }: { role: string; pending?: number }) {
  const pathname = usePathname();
  const admin = role === "platform_admin" || role === "community_admin";
  const [count, setCount] = useState(pending);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/pending-count", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { count?: number };
        if (alive && typeof data.count === "number") setCount(data.count);
      } catch {
        // Preserve the last known count while the network recovers.
      }
    };
    load();
    window.addEventListener("focus", load);
    const timer = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
      window.clearInterval(timer);
    };
  }, [pathname]);

  return (
    <nav className="nav" aria-label="Workspace">
      <div className="nav__label">Workspace</div>
      {items
        .filter((item) => (!("platformOnly" in item) || !item.platformOnly || role === "platform_admin") && (!("adminOnly" in item) || !item.adminOnly || admin))
        .map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              <Icon name={item.icon as IconName} />
              <span className="nav__text">
                <span>{item.label}</span>
                {item.href === "/review" && count > 0 && (
                  <span className="nav__count" aria-label={`${count} pending events`}>{count}</span>
                )}
              </span>
            </Link>
          );
        })}
    </nav>
  );
}
