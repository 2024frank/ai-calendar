"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunActions({
  sourceId,
  discoveryStatus,
}: {
  sourceId: number;
  discoveryStatus: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A source cannot extract until Discovery has produced a recipe. While it is
  // still discovering (or never has), running makes no sense.
  const canRun = discoveryStatus === "ready" || discoveryStatus === "stale";
  const discovering = discoveryStatus === "discovering";

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
        <button
          className="btn primary"
          disabled={!!busy || !canRun}
          title={canRun ? undefined : "Available once discovery finishes."}
          onClick={() => go("run")}
        >
          {busy === "run" ? "Starting…" : "Run now"}
        </button>
        <button className="btn" disabled={!!busy || discovering} onClick={() => go("discover")}>
          {busy === "discover" ? "Starting…" : "Re-discover"}
        </button>
      </div>
      {!canRun && !error && (
        <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          {discovering
            ? "Discovery is still running. Run now unlocks when it finishes."
            : discoveryStatus === "failed"
              ? "Discovery failed. Re-discover before running."
              : "Run discovery first so the agent learns this source."}
        </div>
      )}
      {error && (
        <div className="badge bad" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}
