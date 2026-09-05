export type TimelineEvent = {
  id: number;
  seq: number;
  ts: string;
  kind: string;
  label: string | null;
  data: Record<string, unknown> | null;
};

export type TimelineSnapshot = {
  events: TimelineEvent[];
  nextAfter: number;
  status: string;
  phase?: string | null;
  terminal: boolean;
  tokens: { prompt: number; completion: number };
};

export type TimelineConnection = {
  state: "connecting" | "connected" | "reconnecting" | "paused";
  message?: string;
  requiresLogin?: boolean;
};

class TimelineHttpError extends Error {
  constructor(readonly status: number) {
    super(`Timeline request failed with ${status}`);
  }
}

/** One request at a time, with a deadline and a bounded recovery window. */
export function startTimelinePolling({
  runId,
  onSnapshot,
  onConnection,
  fetcher = fetch,
}: {
  runId: number;
  onSnapshot: (snapshot: TimelineSnapshot) => void;
  onConnection: (connection: TimelineConnection) => void;
  fetcher?: typeof fetch;
}) {
  let cancelled = false;
  let after = 0;
  let failures = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function tick() {
    if (cancelled) return;
    controller = new AbortController();
    const deadline = setTimeout(() => controller?.abort(), 15_000);
    let delay = 1_000;
    try {
      const response = await fetcher(`/api/runs/${runId}/events?after=${after}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new TimelineHttpError(response.status);
      const snapshot = (await response.json()) as TimelineSnapshot;
      if (!Array.isArray(snapshot.events) || !Number.isFinite(snapshot.nextAfter)
        || typeof snapshot.status !== "string" || typeof snapshot.terminal !== "boolean"
        || !Number.isFinite(snapshot.tokens?.prompt) || !Number.isFinite(snapshot.tokens?.completion)) {
        throw new Error("Invalid timeline response");
      }
      if (cancelled) return;
      after = Math.max(after, snapshot.nextAfter);
      failures = 0;
      onSnapshot(snapshot);
      onConnection({ state: "connected" });
      if (snapshot.terminal) return;
    } catch (error) {
      if (cancelled) return;
      failures += 1;
      const status = error instanceof TimelineHttpError ? error.status : null;
      const denied = status === 401 || status === 403 || status === 404;
      if (denied || failures >= 5) {
        onConnection({
          state: "paused",
          requiresLogin: status === 401,
          message: status === 401 ? "Your session expired. Sign in to load this timeline."
            : status === 403 ? "You no longer have access to this run."
              : status === 404 ? "This run is no longer available."
                : "Timeline updates are paused because the connection failed. Retry to check the run again.",
        });
        return;
      }
      delay = Math.min(1_000 * 2 ** failures, 15_000);
      onConnection({ state: "reconnecting", message: "Connection interrupted. Retrying automatically…" });
    } finally {
      clearTimeout(deadline);
      controller = undefined;
    }
    if (!cancelled) timer = setTimeout(tick, delay);
  }

  void tick();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
  };
}
