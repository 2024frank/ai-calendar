import "server-only";

/**
 * Best-effort in-process fixed-window limiter. It throttles brute-force within a
 * single instance (and fully in dev). A serverless fleet can still spread load
 * across instances, so this is defense-in-depth on top of scrypt hashing and
 * high-entropy tokens, not the sole control.
 */
type Bucket = { count: number; reset: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count += 1;
  return true;
}

/** Coarse client identifier from proxy headers, falling back to a constant. */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return ip;
}

// Opportunistic cleanup so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k);
}, 60_000).unref?.();
