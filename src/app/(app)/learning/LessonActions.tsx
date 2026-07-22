"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Undo a lesson, or bring one back. Retired lessons stop reaching the agents. */
export function LessonActions({ id, status }: { id: number; status: "active" | "retired" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function set(next: "active" | "retired") {
    setBusy(true);
    const res = await fetch(`/api/learnings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return status === "active" ? (
    <button className="btn" type="button" disabled={busy} onClick={() => set("retired")}
      title="Stop giving this lesson to the agents. Nothing is deleted.">
      {busy ? "…" : "Retire"}
    </button>
  ) : (
    <button className="btn" type="button" disabled={busy} onClick={() => set("active")}
      title="Start giving this lesson to the agents again.">
      {busy ? "…" : "Restore"}
    </button>
  );
}
