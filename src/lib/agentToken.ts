import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * A per-run token so the extraction agent can POST its results back to us and
 * nobody else can. It is an HMAC of the run id, so no column is needed and it is
 * only valid while that run exists. The agent receives it inside its own prompt.
 */
export function runToken(runId: number): string {
  const secret = process.env.AGENT_INGEST_SECRET;
  if (!secret) throw new Error("AGENT_INGEST_SECRET is not set");
  return createHmac("sha256", secret).update(String(runId)).digest("hex");
}

export function verifyRunToken(runId: number, token: string): boolean {
  if (!token) return false;
  const expected = runToken(runId);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
