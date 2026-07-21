"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const items = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/review", label: "Pending events" },
  { href: "/sources", label: "Sources", adminOnly: true },
  { href: "/users", label: "Users", adminOnly: true },
  { href: "/communities", label: "Communities", platformOnly: true },
  { href: "/metrics", label: "Pilot metrics", platformOnly: true },
];

export function Nav({ role, pending = 0 }: { role: string; pending?: number }) {
  const p = usePathname();
  const admin = role === "platform_admin" || role === "community_admin";

  // Seed from the server value, then keep it live so the badge never goes stale
  // in the client router cache: refetch on navigation, on focus, and on a timer.
  const [count, setCount] = useState(pending);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/pending-count", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (alive && typeof data.count === "number") setCount(data.count);
      } catch {
        /* keep the last value */
      }
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [p]);

  return (
    <nav className="nav">
      {items
        .filter((i) => (!i.platformOnly || role === "platform_admin") && (!i.adminOnly || admin))
        .map((i) => {
          const active = p === i.href || p.startsWith(i.href + "/");
          return (
            <Link key={i.href} href={i.href} className={active ? "active" : ""}>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                {i.label}
                {i.href === "/review" && count > 0 && (
                  <span className="badge good" style={{ minWidth: 20, textAlign: "center" }}>
                    {count}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
    </nav>
  );
}
