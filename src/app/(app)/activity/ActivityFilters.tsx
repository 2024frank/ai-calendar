"use client";

import { useRouter, useSearchParams } from "next/navigation";

export function ActivityFilters({
  actors,
  actions,
  actionLabels,
}: {
  actors: { id: number; label: string }[];
  actions: string[];
  actionLabels: Record<string, string>;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`/activity${next.toString() ? `?${next}` : ""}`);
  }

  return (
    <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
      <select className="input" style={{ maxWidth: 220 }} value={params.get("actor") ?? ""} onChange={(e) => set("actor", e.target.value)}>
        <option value="">Everyone</option>
        {actors.map((a) => (
          <option key={a.id} value={a.id}>{a.label}</option>
        ))}
      </select>
      <select className="input" style={{ maxWidth: 220 }} value={params.get("action") ?? ""} onChange={(e) => set("action", e.target.value)}>
        <option value="">Every action</option>
        {actions.map((a) => (
          <option key={a} value={a}>{actionLabels[a] ?? a}</option>
        ))}
      </select>
    </div>
  );
}
