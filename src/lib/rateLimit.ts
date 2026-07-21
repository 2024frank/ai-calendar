import "server-only";

import { createHash, createHmac } from "crypto";
import { eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimitBuckets } from "@/db/schema";

type Bucket = { count: number; reset: number };
const localBuckets = new Map<string, Bucket>();

function keyHash(key: string) {
  const secret = process.env.AUTH_JWT_SECRET;
  return secret
    ? createHmac("sha256", secret).update(key).digest("hex")
    : createHash("sha256").update(key).digest("hex");
}

function localRateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const bucket = localBuckets.get(key);
  if (!bucket || now >= bucket.reset) {
    localBuckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

/**
 * Fleet-wide fixed-window limiter.
 *
 * Production uses MySQL so limits cannot be bypassed by hopping between
 * serverless instances. Local development without a configured database keeps
 * the old in-memory behavior for convenience.
 */
export async function rateLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  if (!process.env.DATABASE_HOST) return localRateLimit(key, max, windowMs);

  const now = Date.now();
  const windowStartedAtMs = Math.floor(now / windowMs) * windowMs;
  const expiresAt = new Date(windowStartedAtMs + windowMs);
  const hash = keyHash(key);

  await db
    .insert(rateLimitBuckets)
    .values({ keyHash: hash, windowStartedAtMs, count: 1, expiresAt })
    .onDuplicateKeyUpdate({
      set: {
        count: sql`if(${rateLimitBuckets.windowStartedAtMs} = ${windowStartedAtMs}, ${rateLimitBuckets.count} + 1, 1)`,
        windowStartedAtMs,
        expiresAt,
      },
    });

  const [bucket] = await db
    .select({ count: rateLimitBuckets.count, windowStartedAtMs: rateLimitBuckets.windowStartedAtMs })
    .from(rateLimitBuckets)
    .where(eq(rateLimitBuckets.keyHash, hash))
    .limit(1);

  return Number(bucket?.count ?? 1) <= max;
}

export async function sweepRateLimitBuckets(now = new Date()) {
  const [result] = await db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.expiresAt, now));
  return Number((result as { affectedRows?: number }).affectedRows ?? 0);
}

/**
 * Client identifier. Prefer x-real-ip, which the trusted deployment proxy sets.
 * x-forwarded-for remains a local-dev fallback only.
 */
export function clientKey(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const xff = req.headers.get("x-forwarded-for") ?? "";
  return xff.split(",")[0].trim() || "unknown";
}
