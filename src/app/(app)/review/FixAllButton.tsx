"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Fix every auto-rejected event. Each event that gets completed flips to
 * pending immediately, so the count here ticks down while the pass runs.
 */
export function FixAllButton({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const [count, setCount] = useState(initialCount);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // While a pass is running, poll so the number visibly drops.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch("/api/corrections/run-all", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (typeof data.count === "number") {
          setCount(data.count);
          if (data.count === 0) {
            setRunning(false);
            setMsg("All corrected.");
          }
          router.refresh();
        }
      } catch {
        /* keep polling */
      }
    }, 6000);
    return () => window.clearInterval(timer);
  }, [running, router]);

  if (initialCount === 0) return null;

  async function go() {
    setRunning(true);
    setMsg(null);
    try {
      const res = await fetch("/api/corrections/run-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setRunning(false);
        setMsg(data.error || "Could not start.");
      }
    } catch {
      setRunning(false);
      setMsg("Network error.");
    }
  }

  return (
    <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 12 }}>
      <button className="btn primary" type="button" disabled={running} onClick={go}>
        {running ? `Fixing… ${count} left` : `Fix all ${count} auto-rejected`}
      </button>
      <span className="muted" style={{ fontSize: 12 }}>
        {running
          ? "Each event moves to Pending the moment it is fixed. You can leave this page."
          : "Re-reads each event's page, fills what is missing, and sends it back to review."}
      </span>
      {msg && <span className={`badge ${msg === "All corrected." ? "good" : "bad"}`}>{msg}</span>}
    </div>
  );
}
