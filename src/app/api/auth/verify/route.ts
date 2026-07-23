import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { loginTokens, users } from "@/db/schema";
import { createSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = process.env.APP_URL || url.origin;
  const raw = url.searchParams.get("token");
  if (!raw) return NextResponse.redirect(new URL("/login?e=missing", base));

  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const [tok] = await db
    .select()
    .from(loginTokens)
    .where(
      and(
        eq(loginTokens.tokenHash, tokenHash),
        eq(loginTokens.kind, "magic"),
        isNull(loginTokens.consumedAt),
      ),
    )
    .limit(1);

  if (!tok || new Date(tok.expiresAt).getTime() < Date.now()) {
    return NextResponse.redirect(new URL("/login?e=invalid", base));
  }

  const [user] = await db.select().from(users).where(eq(users.id, tok.userId)).limit(1);
  if (!user || user.status !== "active") {
    return NextResponse.redirect(new URL("/login?e=inactive", base));
  }

  // A magic link always logs the person in directly, even on their first visit.
  // The token is a proof of email ownership, so a session is created here and
  // they land where the link points (e.g. an email digest -> /review). Setting a
  // password is optional and lives behind the separate forgot-password flow.
  const [consumed] = await db
    .update(loginTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(loginTokens.id, tok.id), isNull(loginTokens.consumedAt)));
  if (Number((consumed as { affectedRows?: number }).affectedRows ?? 0) !== 1) {
    return NextResponse.redirect(new URL("/login?e=invalid", base));
  }

  await createSession({
    uid: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    communityId: user.communityId ?? null,
    canReviewAllSources: user.canReviewAllSources,
  });

  // Honor a same-site redirect (e.g. an email digest links straight to /review).
  // Only relative paths are allowed, so a token link can never bounce off-site.
  const next = url.searchParams.get("next");
  const dest = next && /^\/[^/]/.test(next) ? next : "/dashboard";
  return NextResponse.redirect(new URL(dest, base));
}
