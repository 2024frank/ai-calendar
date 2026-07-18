"use client";

import { useEffect, useRef, useState } from "react";

type Evt = {
  id: number;
  seq: number;
  ts: string;
  kind: string;
  label: string | null;
  data: Record<string, unknown> | null;
};

const KIND_COLOR: Record<string, string> = {
  run_started: "var(--accent)",
  fetch_issued: "var(--muted)",
  fetch_result: "var(--muted)",
  model_turn: "var(--accent)",
  budget_checkpoint: "var(--muted)",
  candidates_parsed: "var(--accent)",
  candidate_validated: "var(--ink)",
  dedup_outcome: "var(--warn)",
  queue_outcome: "var(--good)",
  run_finished: "var(--good)",
  run_failed: "var(--bad)",
};

export function LiveTimeline({ runId }: { runId: number }) {
  const [events, setEvents] = useState<Evt[]>([]);
  const [status, setStatus] = useState<string>("running");
  const [tokens, setTokens] = useState({ prompt: 0, completion: 0 });
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Per-effect flag (not a ref) so React's dev double-mount cannot leave two
    // polling loops alive appending the same events.
    let cancelled = false;
    let after = 0;

    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/runs/${runId}/events?after=${after}`, { cache: "no-store" });
        const d = await res.json();
        if (Array.isArray(d.events) && d.events.length) {
          after = d.nextAfter;
          setEvents((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            const add = (d.events as Evt[]).filter((e) => !seen.has(e.id));
            return add.length ? [...prev, ...add] : prev;
          });
        }
        if (d.status) setStatus(d.status);
        if (d.tokens) setTokens(d.tokens);
        if (d.terminal) return;
      } catch {
        /* transient; keep polling */
      }
      if (!cancelled) setTimeout(tick, 1000);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [events.length]);

  const live = status === "running";

  return (
    <div>
      <div className="spread" style={{ marginBottom: 12 }}>
        <h3>Timeline</h3>
        <div className="row">
          <span className="muted" style={{ fontSize: 12 }}>
            {tokens.prompt + tokens.completion > 0
              ? `${(tokens.prompt + tokens.completion).toLocaleString()} tokens`
              : ""}
          </span>
          <span className={`badge ${live ? "warn" : status === "failed" ? "bad" : "good"}`}>
            {live ? "live" : status}
          </span>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="muted">{live ? "Waiting for the first step…" : "No steps recorded."}</div>
      ) : (
        <div className="grid" style={{ gap: 6 }}>
          {events.map((ev) => (
            <div key={ev.id} className="row" style={{ alignItems: "flex-start", gap: 12 }}>
              <div className="muted" style={{ fontSize: 11, width: 62, flexShrink: 0 }}>
                {new Date(ev.ts).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </div>
              <div
                style={{
                  width: 132,
                  flexShrink: 0,
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: "0.03em",
                  textTransform: "uppercase",
                  color: KIND_COLOR[ev.kind] ?? "var(--muted)",
                }}
              >
                {ev.kind.replace(/_/g, " ")}
              </div>
              <div style={{ fontSize: 13 }}>{ev.label}</div>
            </div>
          ))}
          <div ref={bottom} />
        </div>
      )}
    </div>
  );
}
