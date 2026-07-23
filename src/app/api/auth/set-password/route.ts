import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { loginTokens, users } from "@/db/schema";
import { createSession } from "@/lib/auth";
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

  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const user = await db.transaction(async (tx) => {
    const [tok] = await tx
      .select()
      .from(loginTokens)
      .where(
        and(
          eq(loginTokens.tokenHash, tokenHash),
          eq(loginTokens.kind, "otp"),
          isNull(loginTokens.consumedAt),
        ),
      )
      .limit(1);
    if (!tok || new Date(tok.expiresAt).getTime() < Date.now()) return null;

    const [account] = await tx.select().from(users).where(eq(users.id, tok.userId)).limit(1);
    if (!account || account.status !== "active") return null;

    const [consumed] = await tx
      .update(loginTokens)
      .set({ consumedAt: new Date() })
      .where(and(eq(loginTokens.id, tok.id), isNull(loginTokens.consumedAt)));
    if (Number((consumed as { affectedRows?: number }).affectedRows ?? 0) !== 1) return null;

    await tx
      .update(users)
      .set({ passwordHash: hashPassword(password), mustSetPassword: false })
      .where(eq(users.id, account.id));
    return account;
  });

  if (!user) {
    return NextResponse.json({ error: "This link has expired. Ask for a new one." }, { status: 400 });
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
