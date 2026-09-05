"use client";

import { useEffect, useState } from "react";
import { Alert, Button, ButtonLink, Skeleton, StatusBadge } from "@/components/ui";
import { startTimelinePolling, type TimelineConnection, type TimelineEvent } from "./timelinePolling";

const KIND_TONE: Record<string, string> = {
  run_started: "var(--accent)", fetch_issued: "var(--muted)", fetch_result: "var(--muted)",
  model_turn: "var(--accent)", budget_checkpoint: "var(--muted)", candidates_parsed: "var(--accent)",
  candidate_validated: "var(--ink)", dedup_outcome: "var(--warn)", queue_outcome: "var(--good)",
  run_finished: "var(--good)", run_failed: "var(--bad)",
};
const numberFormatter = new Intl.NumberFormat("en-US");
export function LiveTimeline({ runId, timeZone, initialStatus, initialPhase, initialTokens }: {
  runId: number;
  timeZone: string;
  initialStatus: string;
  initialPhase?: string | null;
  initialTokens: { prompt: number; completion: number };
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [status, setStatus] = useState(initialStatus);
  const [phase, setPhase] = useState(initialPhase);
  const [tokens, setTokens] = useState(initialTokens);
  const [connection, setConnection] = useState<TimelineConnection>({ state: "connecting" });
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    return startTimelinePolling({
      runId,
      onConnection: setConnection,
      onSnapshot: (data) => {
        if (data.events.length) {
          setEvents((previous) => {
            const seen = new Set(previous.map((event) => event.id));
            const additions = data.events.filter((event) => !seen.has(event.id));
            return additions.length ? [...previous, ...additions] : previous;
          });
        }
        setStatus(data.status);
        setPhase(data.phase);
        setTokens(data.tokens);
        setLoaded(true);
      },
    });
  }, [runId, attempt]);

  const live = status === "running";
  const queued = live && phase === "queued";
  const awaitingCallback = live && phase === "awaiting_callback";
  const paused = connection.state === "paused";
  const reconnecting = connection.state === "reconnecting";
  const badgeTone = paused || reconnecting ? "warning"
    : queued || awaitingCallback ? "neutral"
      : live ? "info"
        : status === "failed" ? "danger"
          : status === "completed" ? "success" : "neutral";
  const badgeLabel = paused ? "Updates paused"
    : reconnecting ? "Reconnecting"
      : queued ? "Queued"
        : awaitingCallback ? "Waiting for results"
          : live ? connection.state === "connecting" ? "Connecting" : "Live"
            : status;
  const totalTokens = tokens.prompt + tokens.completion;
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <section aria-labelledby="timeline-title">
      <div className="section-header">
        <div><h2 id="timeline-title">Run Timeline</h2><p>{live ? "New steps appear automatically while the agent is working." : "Recorded steps from this run."}</p></div>
        <div className="row">
          {totalTokens > 0 && <span className="muted numeric" style={{ fontSize: 12 }}>{numberFormatter.format(totalTokens)} tokens</span>}
          <StatusBadge tone={badgeTone}>{badgeLabel}</StatusBadge>
        </div>
      </div>

      {(paused || reconnecting) && <Alert tone="warning">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <span>{connection.message}</span>
          {paused && (connection.requiresLogin
            ? <ButtonLink href="/login" size="sm">Sign in</ButtonLink>
            : <Button size="sm" onClick={() => { setConnection({ state: "connecting" }); setAttempt((value) => value + 1); }}>Retry timeline</Button>)}
        </div>
      </Alert>}

      {events.length === 0 ? (
        !loaded && !paused ? <div className="timeline-loading" role="status" aria-live="polite"><span className="sr-only">Loading timeline…</span><Skeleton /><Skeleton /><Skeleton /></div>
          : !loaded ? null
            : live ? <p className="muted">{queued ? "This run is queued. Its steps will appear when a worker starts." : "Waiting for the first recorded step…"}</p>
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
        </div>
      )}
    </section>
  );
}
