import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { loginTokens, users } from "@/db/schema";
import { sendPasswordSetup } from "@/lib/email";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (!(await rateLimit(`forgot:${clientKey(req)}`, 6, 10 * 60_000))) {
    return NextResponse.json({ ok: true }); // stay quiet; do not reveal throttling
  }

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), eq(users.status, "active")))
    .limit(1);

  // Only people already added here may set or reset a password. An unknown email
  // is told plainly it is not authorized, rather than a quiet "check your inbox".
  if (!user) {
    return NextResponse.json(
      { error: "This email is not authorized. Ask an admin to add you." },
      { status: 401 },
    );
  }

  const rawToken = randomBytes(32).toString("hex");
  await db.insert(loginTokens).values({
    userId: user.id,
    kind: "magic",
    tokenHash: createHash("sha256").update(rawToken).digest("hex"),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const base = process.env.APP_URL || new URL(req.url).origin;
  const link = `${base}/set-password?token=${rawToken}`;
  const res = await sendPasswordSetup(email, link, !user.mustSetPassword);
  const devLink = process.env.NODE_ENV !== "production" ? res.devLink : undefined;

  return NextResponse.json({ ok: true, ...(devLink ? { devLink } : {}) });
}
