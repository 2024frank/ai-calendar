"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/review", label: "Review" },
  { href: "/sources", label: "Sources" },
  { href: "/users", label: "Users", adminOnly: true },
  { href: "/communities", label: "Communities", platformOnly: true },
];

export function Nav({ role }: { role: string }) {
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
              {i.label}
            </Link>
          );
        })}
    </nav>
  );
}
