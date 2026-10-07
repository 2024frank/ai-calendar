import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, users } from "@/db/schema";
import { verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rateLimit";

export const MAX_PASSWORD_LENGTH = 128;

type UserRow = typeof users.$inferSelect;

export type PasswordLoginResult =
  | { ok: true; user: UserRow; communityStatus: string | null }
  | { ok: false; reason: "bad_request" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number }
  | { ok: false; reason: "invalid_credentials" };

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * The password check shared by the browser login and the Studios endpoint:
 * throttle, look up the active account, verify the hash. It never starts a
 * session, so each caller decides what a successful check means.
 */
export async function checkPasswordLogin(opts: {
  email: unknown;
  password: unknown;
  /** Identifies the client for the per-IP throttle. */
  clientId: string;
}): Promise<PasswordLoginResult> {
  const email = normalizeEmail(opts.email);
  const password = String(opts.password ?? "");
  if (!email || !password || password.length > MAX_PASSWORD_LENGTH) return { ok: false, reason: "bad_request" };

  // Per-IP and per-account throttles: the account bucket blunts a distributed
  // spray that rotates IPs to dodge the per-IP limit.
  if (!(await rateLimit(`login:${opts.clientId}:${email}`, 8, 10 * 60_000))) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: 10 * 60 };
  }
  if (!(await rateLimit(`login-acct:${email}`, 20, 15 * 60_000))) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: 15 * 60 };
  }

  const [row] = await db
    .select({ user: users, communityStatus: communities.status })
    .from(users)
    .leftJoin(communities, eq(communities.id, users.communityId))
    .where(and(eq(users.email, email), eq(users.status, "active")))
    .limit(1);

  // Uniform failure for wrong password, unknown account, and not-yet-set
  // password, so login can't be used to enumerate who has an account.
  const user = row?.user;
  if (!user || !user.passwordHash || user.mustSetPassword || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, reason: "invalid_credentials" };
  }
  return { ok: true, user, communityStatus: row.communityStatus ?? null };
}
