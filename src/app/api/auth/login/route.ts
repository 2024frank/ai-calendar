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
  if (!rateLimit(`login:${clientKey(req)}:${email}`, 8, 10 * 60_000)) {
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

  // No password yet: tell the client to run the set-password flow.
  if (user && (!user.passwordHash || user.mustSetPassword)) {
    return NextResponse.json(
      { error: "You need to set a password first.", needsPassword: true },
      { status: 409 },
    );
  }

  if (!user || !verifyPassword(password, user.passwordHash)) {
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
