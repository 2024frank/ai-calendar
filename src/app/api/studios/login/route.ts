import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { checkPasswordLogin } from "@/lib/passwordLogin";
import { clientKey } from "@/lib/rateLimit";
import { readJsonObjectBody } from "@/lib/requestBody";
import { bearerMatches, isUsableSecret } from "@/lib/studiosSso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function reply(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * Server-to-server password check for CH Studios. Studios posts the credentials
 * a person typed on its own sign-in page. This sets no cookie and starts no
 * AI Calendar session, so it never touches the users table.
 */
export async function POST(req: Request) {
  const secret = process.env.STUDIOS_SSO_SECRET;
  if (!isUsableSecret(secret)) return reply({ error: "not_configured" }, 503);
  if (!bearerMatches(req.headers.get("authorization"), secret)) return reply({ error: "unauthorized" }, 401);

  const parsed = await readJsonObjectBody(req, 16 * 1024);
  const { email, password } = parsed.ok ? parsed.body : ({} as Record<string, unknown>);
  if (!parsed.ok || typeof email !== "string" || typeof password !== "string") {
    return reply({ error: "bad_request" }, 400);
  }

  // Studios forwards the browser's address so one visitor cannot lock out the
  // whole Studios deployment. Only trusted because the bearer already matched.
  const forwarded = req.headers.get("x-studios-client-ip")?.trim().slice(0, 64);
  const result = await checkPasswordLogin({ email, password, clientId: forwarded || clientKey(req) });
  if (!result.ok) {
    if (result.reason === "bad_request") return reply({ error: "bad_request" }, 400);
    if (result.reason === "rate_limited") {
      return reply({ error: "rate_limited", retryAfter: result.retryAfterSeconds }, 429, {
        "Retry-After": String(result.retryAfterSeconds),
      });
    }
    return reply({ error: "invalid_credentials" }, 401);
  }

  // A suspended community blocks sign-in everywhere else; platform admins sit outside communities.
  const { user, communityStatus } = result;
  if (user.role !== "platform_admin" && communityStatus !== "active") {
    return reply({ error: "invalid_credentials" }, 401);
  }

  await logActivity({
    action: "login",
    actorUserId: user.id,
    actorEmail: user.email,
    summary: `${user.email} signed in to Studios`,
  });
  return reply(
    { user: { id: user.id, email: user.email, name: user.name ?? null, role: user.role, communityId: user.communityId ?? null } },
    200,
  );
}
