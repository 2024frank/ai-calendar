import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { consumeLoginToken } from "@/lib/loginToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = process.env.APP_URL || url.origin;
  const raw = url.searchParams.get("token");
  if (!raw) return NextResponse.redirect(new URL("/login?e=missing", base));

  const consumed = await consumeLoginToken(raw, ["magic"]);
  if (!consumed) {
    return NextResponse.redirect(new URL("/login?e=invalid", base));
  }
  const { user } = consumed;

  // A magic link always logs the person in directly, even on their first visit.
  // The token is a proof of email ownership, so a session is created here and
  // they land where the link points (e.g. an email digest -> /review). Setting a
  // password is optional and lives behind the separate forgot-password flow.
  await createSession({
    uid: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    communityId: user.communityId ?? null,
    canReviewAllSources: user.canReviewAllSources,
    sessionVersion: user.sessionVersion,
  });

  // Honor a same-site redirect (e.g. an email digest links straight to /review).
  // Only relative paths are allowed, so a token link can never bounce off-site.
  const next = url.searchParams.get("next");
  const dest = next && /^\/[^/]/.test(next) ? next : "/dashboard";
  return NextResponse.redirect(new URL(dest, base));
}
