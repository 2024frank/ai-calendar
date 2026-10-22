"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const items = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/review", label: "Review Queue" },
  { href: "/sources", label: "Sources", adminOnly: true },
  { href: "/users", label: "Users", adminOnly: true },
  { href: "/communities", label: "Communities", platformOnly: true },
  { href: "/metrics", label: "Pilot Metrics", platformOnly: true },
  { href: "/learning", label: "Training Data", adminOnly: true },
  { href: "/activity", label: "Activity Log", platformOnly: true },
] as const;

export function Nav({ role, pending = 0 }: { role: string; pending?: number }) {
  const pathname = usePathname();
  const admin = role === "platform_admin" || role === "community_admin";
  const [count, setCount] = useState(pending);

  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    const load = async () => {
      if (controller || document.visibilityState === "hidden") return;
      controller = new AbortController();
      const current = controller;
      const deadline = window.setTimeout(() => current.abort(), 15_000);
      try {
        const response = await fetch("/api/pending-count", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = (await response.json()) as { count?: number };
        if (alive && typeof data.count === "number") setCount(data.count);
      } catch {
        // Preserve the last known count while the network recovers.
      } finally {
        window.clearTimeout(deadline);
        controller = null;
      }
    };
    load();
    window.addEventListener("focus", load);
    const timer = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      controller?.abort();
      window.removeEventListener("focus", load);
      window.clearInterval(timer);
    };
  }, [pathname]);

  return (
    <nav className="nav" aria-label="Primary">
      {items
        .filter((item) => (!("platformOnly" in item) || !item.platformOnly || role === "platform_admin") && (!("adminOnly" in item) || !item.adminOnly || admin))
        .map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              <span>{item.label}</span>
              {item.href === "/review" && count > 0 && (
                <span className="nav__count" aria-label={`${count} pending events`}>{count}</span>
              )}
            </Link>
          );
        })}
    </nav>
  );
}
