"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunActions({ sourceId }: { sourceId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(kind: "run" | "discover") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/sources/${sourceId}/${kind}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.runId) {
        setError(data.error || "Could not start the run.");
        setBusy(null);
        return;
      }
      router.push(`/runs/${data.runId}`);
    } catch {
      setError("Network error.");
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="row">
        <button className="btn primary" disabled={!!busy} onClick={() => go("run")}>
          {busy === "run" ? "Starting…" : "Run now"}
        </button>
        <button className="btn" disabled={!!busy} onClick={() => go("discover")}>
          {busy === "discover" ? "Starting…" : "Re-discover"}
        </button>
      </div>
      {error && (
        <div className="badge bad" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
