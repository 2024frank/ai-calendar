import "server-only";
import { WORKER_DISPATCH_ATTEMPTS } from "./jobPolicy";

/**
 * Start one isolated serverless worker invocation.
 *
 * The worker returns 202 immediately, processes one job in `after()`, and then
 * starts the next invocation if work remains. This gives the durable queue a
 * sequential consumer without putting twelve long model calls in one function.
 */
export async function dispatchWorker(
  recoveryAttempt = 0,
  requestOrigin?: string,
): Promise<boolean> {
  const secret = process.env.WORKER_SECRET || process.env.CRON_SECRET;
  if (!secret || !requestOrigin) return false;

  let endpoint: URL;
  try {
    const base = new URL(requestOrigin);
    if (base.origin !== requestOrigin) return false;
    endpoint = new URL("/api/internal/jobs?limit=1", base);
    if (process.env.NODE_ENV === "production" && endpoint.protocol !== "https:") return false;
  } catch {
    return false;
  }

  for (let attempt = 0; attempt < WORKER_DISPATCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "x-ai-calendar-worker-chain": "1",
          "x-ai-calendar-worker-recovery": String(recoveryAttempt),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      // Fully consume the tiny 202 response. Aborting the response stream can
      // look like a disconnected caller to some hosts and jeopardize `after()`.
      await response.arrayBuffer().catch(() => undefined);
      if (response.ok) return true;
    } catch {
      // The next bounded attempt handles transient network/platform failures.
    }
    if (attempt + 1 < WORKER_DISPATCH_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  return false;
}
