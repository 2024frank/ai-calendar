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
    .where(and(eq(loginTokens.tokenHash, tokenHash), isNull(loginTokens.consumedAt)))
    .limit(1);

  if (!tok || new Date(tok.expiresAt).getTime() < Date.now()) {
    return NextResponse.redirect(new URL("/login?e=invalid", base));
  }
  await db.update(loginTokens).set({ consumedAt: new Date() }).where(eq(loginTokens.id, tok.id));

  const [user] = await db.select().from(users).where(eq(users.id, tok.userId)).limit(1);
  if (!user || user.status !== "active") {
    return NextResponse.redirect(new URL("/login?e=inactive", base));
  }

  await createSession({
    uid: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    communityId: user.communityId ?? null,
    canReviewAllSources: user.canReviewAllSources,
  });

  return NextResponse.redirect(new URL("/dashboard", base));
}
