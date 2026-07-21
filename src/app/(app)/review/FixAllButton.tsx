"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fix auto-rejected events one at a time, with a progress bar.
 *
 * Each click walks the queue: one request per event, so every prompt is small
 * and cheap and no request can run long enough to time out. A fixed event moves
 * to Pending immediately, so the count drops as it goes.
 *
 * Every number shown here comes back from the database on each step, not from a
 * tally kept in this tab. Closing the page and returning shows the same totals
 * and picks the pass back up where it stopped.
 */

type Progress = {
  /** Events this pass has looked at. */
  checked: number;
  /** Events this pass actually completed and sent back to review. */
  corrected: number;
  /** Auto-rejected events still worth attempting. */
  remaining: number;
  costUsd: number;
  tokens: number;
};

const ZERO: Progress = { checked: 0, corrected: 0, remaining: 0, costUsd: 0, tokens: 0 };

const money = (usd: number) =>
  usd >= 0.01 ? `$${usd.toFixed(2)}` : usd > 0 ? `$${usd.toFixed(4)}` : "$0.00";

export function FixAllButton({ initialCount, sourceId }: { initialCount: number; sourceId?: number }) {
  const router = useRouter();
  const [p, setP] = useState<Progress>({ ...ZERO, remaining: initialCount });
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const stop = useRef(false);

  const go = useCallback(
    async function go(resumeRunId?: number) {
      setRunning(true);
      setMsg(null);
      stop.current = false;
      let runId: number | undefined = resumeRunId;
      let done = false;

      while (!done && !stop.current) {
        try {
          const res = await fetch("/api/corrections/next", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ runId, sourceId }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            setMsg(err.error || "Stopped.");
            break;
          }
          const data = (await res.json()) as Progress & {
            done: boolean;
            fixed: boolean;
            title: string | null;
            runId: number;
          };
          runId = data.runId;
          done = data.done;
          setCurrent(data.title);
          setP({
            checked: data.checked,
            corrected: data.corrected,
            remaining: data.remaining,
            costUsd: data.costUsd,
            tokens: data.tokens,
          });
          if (data.fixed) router.refresh(); // the event is already in Pending
        } catch {
          setMsg("Network error, stopped.");
          break;
        }
      }

      setRunning(false);
      setCurrent(null);
      if (done) setMsg("Finished.");
      router.refresh();
    },
    [router, sourceId],
  );

  // Progress lives in the database, not in this tab. On load, read the true
  // totals and pick up any pass that was interrupted by leaving.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const qs = sourceId ? `?sourceId=${sourceId}` : "";
        const res = await fetch(`/api/corrections/next${qs}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Progress & { openRunId: number | null };
        if (!alive) return;
        setP({
          checked: data.checked,
          corrected: data.corrected,
          remaining: data.remaining,
          costUsd: data.costUsd,
          tokens: data.tokens,
        });
        if (data.openRunId && data.remaining > 0) {
          setMsg("Resuming where it left off.");
          void go(data.openRunId);
        }
      } catch {
        /* keep the server-rendered count */
      }
    })();
    return () => {
      alive = false;
    };
  }, [go, sourceId]);

  if (initialCount === 0 && p.remaining === 0 && p.checked === 0) return null;

  const total = p.checked + p.remaining;
  const pct = total > 0 ? Math.round((p.checked / total) * 100) : 0;
  const showBar = running || p.checked > 0;

  return (
    <div className="grid" style={{ gap: 10, marginBottom: 12 }}>
      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn primary" type="button" disabled={running} onClick={() => go()}>
          {running ? `Fixing… ${p.remaining} left` : `Fix ${p.remaining} auto-rejected`}
        </button>
        {running && (
          <button
            className="btn"
            type="button"
            onClick={() => {
              stop.current = true;
            }}
          >
            Stop
          </button>
        )}
        {!showBar && (
          <span className="muted" style={{ fontSize: 12 }}>
            Opens each event&rsquo;s page, fills what is missing, and sends it back to review one by one.
          </span>
        )}
        {msg && <span className={`badge ${msg === "Finished." ? "good" : "bad"}`}>{msg}</span>}
      </div>

      {showBar && (
        <div className="grid" style={{ gap: 6 }}>
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Correction progress"
            style={{
              height: 8,
              borderRadius: 999,
              background: "var(--surface-3, rgba(127,127,127,.18))",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                borderRadius: 999,
                background: "var(--accent, #2f6feb)",
                transition: "width .35s ease",
              }}
            />
          </div>
          <div className="row" style={{ gap: 14, flexWrap: "wrap", fontSize: 12 }}>
            <span>
              <strong>{p.corrected}</strong> fixed and back in review
            </span>
            <span className="muted">
              {p.checked} of {total} checked
            </span>
            <span className="muted">
              {money(p.costUsd)} spent · {p.tokens.toLocaleString()} tokens
            </span>
            {current && <span className="muted">Working on &ldquo;{current.slice(0, 40)}&rdquo;</span>}
          </div>
        </div>
      )}
    </div>
  );
}
