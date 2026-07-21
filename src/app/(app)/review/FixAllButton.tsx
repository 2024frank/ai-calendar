"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * Fix auto-rejected events one at a time.
 *
 * Each click walks the queue: one request per event, so every prompt is small
 * and cheap and no request can run long enough to time out. A fixed event moves
 * to Pending immediately, so the count drops as it goes.
 */
export function FixAllButton({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const [count, setCount] = useState(initialCount);
  const [running, setRunning] = useState(false);
  const [fixed, setFixed] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const stop = useRef(false);

  if (initialCount === 0) return null;

  async function go() {
    setRunning(true);
    setMsg(null);
    setFixed(0);
    stop.current = false;
    let runId: number | undefined;
    let done = false;

    while (!done && !stop.current) {
      try {
        const res = await fetch("/api/corrections/next", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setMsg(err.error || "Stopped.");
          break;
        }
        const data = (await res.json()) as {
          done: boolean;
          fixed: boolean;
          title: string | null;
          remaining: number;
          runId: number;
        };
        runId = data.runId;
        done = data.done;
        setCount(data.remaining);
        setCurrent(data.title);
        if (data.fixed) {
          setFixed((n) => n + 1);
          router.refresh(); // the event is already in Pending
        }
      } catch {
        setMsg("Network error, stopped.");
        break;
      }
    }

    setRunning(false);
    setCurrent(null);
    if (done) setMsg("Finished.");
    router.refresh();
  }

  return (
    <div className="row" style={{ gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
      <button className="btn primary" type="button" disabled={running} onClick={go}>
        {running ? `Fixing… ${count} left` : `Fix ${count} auto-rejected`}
      </button>
      {running && (
        <button className="btn" type="button" onClick={() => { stop.current = true; }}>
          Stop
        </button>
      )}
      <span className="muted" style={{ fontSize: 12 }}>
        {running
          ? `${fixed} fixed so far${current ? ` · checking "${current.slice(0, 40)}"` : ""}`
          : "Opens each event's page, fills what is missing, and sends it back to review one by one."}
      </span>
      {msg && <span className={`badge ${msg === "Finished." ? "good" : "bad"}`}>{msg}</span>}
    </div>
  );
}
