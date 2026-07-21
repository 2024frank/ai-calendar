import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  // Per-IP and per-account throttles: the account bucket blunts a distributed
  // spray that rotates IPs to dodge the per-IP limit.
  const throttled =
    !(await rateLimit(`login:${clientKey(req)}:${email}`, 8, 10 * 60_000)) ||
    !(await rateLimit(`login-acct:${email}`, 20, 15 * 60_000));
  if (throttled) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429 },
    );
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), eq(users.status, "active")))
    .limit(1);

  // Uniform failure for wrong password, unknown account, and not-yet-set
  // password, so login can't be used to enumerate who has an account.
  if (!user || !user.passwordHash || user.mustSetPassword || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  await createSession({
    uid: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    communityId: user.communityId ?? null,
    canReviewAllSources: user.canReviewAllSources,
  });
  return NextResponse.json({ ok: true });
}
