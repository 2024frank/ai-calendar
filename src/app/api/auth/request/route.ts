import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { loginTokens, users } from "@/db/schema";
import { sendMagicLink } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), eq(users.status, "active")))
    .limit(1);

  // Respond ok regardless (no account enumeration); only send when the user exists.
  let devLink: string | undefined;
  if (user) {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await db.insert(loginTokens).values({
      userId: user.id,
      kind: "magic",
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    const base = process.env.APP_URL || new URL(req.url).origin;
    const link = `${base}/api/auth/verify?token=${rawToken}`;
    const res = await sendMagicLink(email, link);
    devLink = res.devLink;
  }

  return NextResponse.json({ ok: true, ...(devLink ? { devLink } : {}) });
}
