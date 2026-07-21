"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton, StatusBadge } from "@/components/ui";

type TimelineEvent = { id: number; seq: number; ts: string; kind: string; label: string | null; data: Record<string, unknown> | null };

const KIND_TONE: Record<string, string> = {
  run_started: "var(--accent)", fetch_issued: "var(--muted)", fetch_result: "var(--muted)",
  model_turn: "var(--accent)", budget_checkpoint: "var(--muted)", candidates_parsed: "var(--accent)",
  candidate_validated: "var(--ink)", dedup_outcome: "var(--warn)", queue_outcome: "var(--good)",
  run_finished: "var(--good)", run_failed: "var(--bad)",
};
const numberFormatter = new Intl.NumberFormat("en-US");
const timeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function LiveTimeline({ runId }: { runId: number }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [status, setStatus] = useState("running");
  const [tokens, setTokens] = useState({ prompt: 0, completion: 0 });
  const [reconnecting, setReconnecting] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let after = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (cancelled) return;
      try {
        const response = await fetch(`/api/runs/${runId}/events?after=${after}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Timeline request failed with ${response.status}`);
        const data = await response.json();
        setReconnecting(false);
        if (Array.isArray(data.events) && data.events.length) {
          after = data.nextAfter;
          setEvents((previous) => {
            const seen = new Set(previous.map((event) => event.id));
            const additions = (data.events as TimelineEvent[]).filter((event) => !seen.has(event.id));
            return additions.length ? [...previous, ...additions] : previous;
          });
        }
        if (data.status) setStatus(data.status);
        if (data.tokens) setTokens(data.tokens);
        if (data.terminal) return;
      } catch {
        setReconnecting(true);
      }
      if (!cancelled) timer = setTimeout(tick, 1000);
    }
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [runId]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottom.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  }, [events.length]);

  const live = status === "running";
  const totalTokens = tokens.prompt + tokens.completion;

  return (
    <section aria-labelledby="timeline-title">
      <div className="section-header">
        <div><h2 id="timeline-title">Run Timeline</h2><p>New steps appear automatically while the agent is working.</p></div>
        <div className="row">
          {totalTokens > 0 && <span className="muted numeric" style={{ fontSize: 12 }}>{numberFormatter.format(totalTokens)} tokens</span>}
          <StatusBadge tone={reconnecting ? "warning" : live ? "info" : status === "failed" ? "danger" : "success"}>
            {reconnecting ? "Reconnecting" : live ? "Live" : status}
          </StatusBadge>
        </div>
      </div>

      {events.length === 0 ? (
        live ? <div className="timeline-loading" role="status" aria-live="polite"><span className="sr-only">Waiting for the first step…</span><Skeleton /><Skeleton /><Skeleton /></div>
          : <p className="muted">No timeline steps were recorded for this run.</p>
      ) : (
        <div className="timeline" role="log" aria-live="polite" aria-relevant="additions">
          {events.map((event) => (
            <article key={event.id} className="timeline__event">
              <time dateTime={event.ts}>{timeFormatter.format(new Date(event.ts))}</time>
              <span className="timeline__marker" style={{ color: KIND_TONE[event.kind] ?? "var(--muted)" }} aria-hidden="true" />
              <div className="timeline__content">
                <span className="timeline__kind" style={{ color: KIND_TONE[event.kind] ?? "var(--muted)" }}>{event.kind.replaceAll("_", " ")}</span>
                <p>{event.label || "Step completed"}</p>
              </div>
            </article>
          ))}
          <div ref={bottom} />
        </div>
      )}
    </section>
  );
}
