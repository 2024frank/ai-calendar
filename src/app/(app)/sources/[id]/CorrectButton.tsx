"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Trigger the correction agent over this source's auto-rejected events. */
export function CorrectButton({ sourceId, autoRejected }: { sourceId: number; autoRejected: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (autoRejected === 0) return null;

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/sources/${sourceId}/correct`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.runId) {
        setErr(data.error || "Could not start.");
        setBusy(false);
        return;
      }
      router.push(`/runs/${data.runId}`);
    } catch {
      setErr("Network error.");
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn" type="button" disabled={busy} onClick={go}>
        {busy ? "Starting…" : `Fix ${autoRejected} auto-rejected`}
      </button>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        The correction agent re-reads each one&apos;s page, fills the missing field, and re-queues it.
      </div>
      {err && <div className="badge bad" style={{ marginTop: 6 }}>{err}</div>}
    </div>
  );
}
