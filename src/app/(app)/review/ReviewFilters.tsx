"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { EVENT_TYPES } from "@/lib/taxonomy";

export function ReviewFilters({ sources }: { sources: { id: number; name: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function apply(next: Record<string, string>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.push(`/review?${sp.toString()}`);
  }

  return (
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q });
        }}
        style={{ flex: "1 1 220px" }}
      >
        <input
          className="input"
          placeholder="Search title or location…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
      <select
        className="input"
        style={{ maxWidth: 220 }}
        value={params.get("source") ?? ""}
        onChange={(e) => apply({ source: e.target.value })}
      >
        <option value="">All sources</option>
        {sources.map((s) => (
          <option key={s.id} value={String(s.id)}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        className="input"
        style={{ maxWidth: 180 }}
        value={params.get("type") ?? ""}
        onChange={(e) => apply({ type: e.target.value })}
      >
        <option value="">All types</option>
        {EVENT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}
