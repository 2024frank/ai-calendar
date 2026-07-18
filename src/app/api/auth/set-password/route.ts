import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { loginTokens, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { hashPassword, passwordProblem } from "@/lib/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const rawToken = String(body.token ?? "");
  const password = String(body.password ?? "");
  if (!rawToken) return NextResponse.json({ error: "Missing link token." }, { status: 400 });

  const problem = passwordProblem(password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const [tok] = await db
    .select()
    .from(loginTokens)
    .where(and(eq(loginTokens.tokenHash, tokenHash), isNull(loginTokens.consumedAt)))
    .limit(1);

  if (!tok || new Date(tok.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: "This link has expired. Ask for a new one." }, { status: 400 });
  }

  const [user] = await db.select().from(users).where(eq(users.id, tok.userId)).limit(1);
  if (!user || user.status !== "active") {
    return NextResponse.json({ error: "This account is not active." }, { status: 403 });
  }

  await db
    .update(users)
    .set({ passwordHash: hashPassword(password), mustSetPassword: false })
    .where(eq(users.id, user.id));
  await db.update(loginTokens).set({ consumedAt: new Date() }).where(eq(loginTokens.id, tok.id));

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
