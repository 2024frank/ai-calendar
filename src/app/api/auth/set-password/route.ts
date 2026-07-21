import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { loginTokens, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { consumeLoginToken } from "@/lib/loginToken";
import { hashPassword, passwordProblem } from "@/lib/password";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await rateLimit(`setpw:${clientKey(req)}`, 20, 10 * 60_000))) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const rawToken = String(body.token ?? "");
  const password = String(body.password ?? "");
  if (!rawToken) return NextResponse.json({ error: "Missing link token." }, { status: 400 });

  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const consumed = await consumeLoginToken(rawToken, ["password_reset", "invite"]);
  if (!consumed) {
    return NextResponse.json({ error: "This link has expired. Ask for a new one." }, { status: 400 });
  }
  const { user } = consumed;
  const nextSessionVersion = user.sessionVersion + 1;

  await db
    .update(users)
    .set({
      passwordHash: hashPassword(password),
      mustSetPassword: false,
      sessionVersion: sql`${users.sessionVersion} + 1`,
    })
    .where(eq(users.id, user.id));
  // A successful password change invalidates every other outstanding reset or
  // invite capability as well as every previously issued session.
  await db
    .update(loginTokens)
    .set({ consumedAt: new Date() })
    .where(eq(loginTokens.userId, user.id));

  await createSession({
    uid: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    communityId: user.communityId ?? null,
    canReviewAllSources: user.canReviewAllSources,
    sessionVersion: nextSessionVersion,
  });
  return NextResponse.json({ ok: true });
}
