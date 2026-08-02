"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Undo a lesson, or bring one back. Retired lessons stop reaching the agents. */
export function LessonActions({ id, status }: { id: number; status: "active" | "retired" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: "active" | "retired") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/learnings/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not update this lesson.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this lesson.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {status === "active" ? (
        <button className="btn" type="button" disabled={busy} onClick={() => set("retired")}
          title="Stop giving this lesson to the agents. Nothing is deleted.">
          {busy ? "…" : "Retire"}
        </button>
      ) : (
        <button className="btn" type="button" disabled={busy} onClick={() => set("active")}
          title="Start giving this lesson to the agents again.">
          {busy ? "…" : "Restore"}
        </button>
      )}
      {error && <div role="alert" style={{ color: "var(--bad)", fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  );
}
