"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/review", label: "Pending events" },
  { href: "/sources", label: "Sources" },
  { href: "/users", label: "Users", adminOnly: true },
  { href: "/communities", label: "Communities", platformOnly: true },
];

export function Nav({ role, pending = 0 }: { role: string; pending?: number }) {
  const p = usePathname();
  const admin = role === "platform_admin" || role === "community_admin";
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
                {i.href === "/review" && pending > 0 && (
                  <span className="badge good" style={{ minWidth: 20, textAlign: "center" }}>
                    {pending}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
    </nav>
  );
}
