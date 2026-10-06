import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isAllowedReturn, isUsableSecret, isValidState, signStudiosToken } from "@/lib/studiosSso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

/** Hands a signed-in AI Calendar user to CH Studios with a short-lived signed token. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");
  const returnUrl = url.searchParams.get("return");

  if (!isValidState(state)) return fail("invalid state", 400);
  // Never redirect anywhere that is not on the allowlist.
  if (!isAllowedReturn(returnUrl, process.env.STUDIOS_RETURN_URLS)) return fail("invalid return", 400);

  const secret = process.env.STUDIOS_SSO_SECRET;
  if (!isUsableSecret(secret)) return fail("sso not configured", 503);

  const base = process.env.APP_URL || url.origin;
  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(`/api/sso/studios${url.search}`);
    return NextResponse.redirect(new URL(`/login?next=${next}`, base), { status: 302, headers: NO_STORE });
  }

  const token = await signStudiosToken({ session, state, secret });
  return NextResponse.redirect(`${returnUrl}?token=${token}`, { status: 302, headers: NO_STORE });
}
