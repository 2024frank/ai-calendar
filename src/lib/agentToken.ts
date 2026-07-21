import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * A per-run token so the extraction agent can POST its results back to us and
 * nobody else can. It is an expiring HMAC capability bound to one run. The
 * callback route also atomically claims the run so the capability cannot replay.
 */
const TOKEN_TTL_SECONDS = 30 * 60;

export function runToken(runId: number, now = Date.now()): string {
  const secret = process.env.AGENT_INGEST_SECRET;
  if (!secret) throw new Error("AGENT_INGEST_SECRET is not set");
  const expires = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const signature = createHmac("sha256", secret)
    .update(`${runId}.${expires}`)
    .digest("hex");
  return `${expires}.${signature}`;
}

export function verifyRunToken(runId: number, token: string): boolean {
  if (!token) return false;
  const [expiresRaw, signature] = token.split(".");
  const expires = Number(expiresRaw);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(expires) || expires < now || expires > now + TOKEN_TTL_SECONDS + 60) return false;
  const secret = process.env.AGENT_INGEST_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(`${runId}.${expires}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
