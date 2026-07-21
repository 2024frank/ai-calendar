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

  // A source can run once it has extraction instructions (saved by the setup
  // wizard's research step, or edited on this page).
  const canRun = discoveryStatus === "ready" || discoveryStatus === "stale";

  async function go() {
    setBusy("run");
    setError(null);
    try {
      const res = await fetch(`/api/sources/${sourceId}/run`, { method: "POST" });
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
          title={canRun ? undefined : "Add extraction instructions first."}
          onClick={go}
        >
          {busy === "run" ? "Starting…" : "Run now"}
        </button>
      </div>
      {!canRun && !error && (
        <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          Save extraction instructions below (Edit source) to unlock Run now.
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
