"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Lets a reviewer or admin move between the communities they belong to. */
export function CommunitySwitcher({
  communities,
  activeId,
}: {
  communities: { id: number; name: string }[];
  activeId: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Nothing to switch between.
  if (communities.length < 2) return null;

  async function change(id: number) {
    setBusy(true);
    await fetch("/api/communities/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ communityId: id }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <div style={{ padding: "0 12px 12px" }}>
      <label className="label" style={{ fontSize: 11 }}>
        Community
      </label>
      <select
        className="input"
        style={{ fontSize: 13 }}
        value={activeId ?? ""}
        disabled={busy}
        onChange={(e) => change(Number(e.target.value))}
      >
        {communities.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
