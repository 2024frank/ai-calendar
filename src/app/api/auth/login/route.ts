import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { checkPasswordLogin } from "@/lib/passwordLogin";
import { clientKey } from "@/lib/rateLimit";
import { readJsonObjectBody } from "@/lib/requestBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const parsed = await readJsonObjectBody(req, 16 * 1024);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.body;
  const result = await checkPasswordLogin({ email: body.email, password: body.password, clientId: clientKey(req) });
  if (!result.ok) {
    if (result.reason === "bad_request") {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }
    if (result.reason === "rate_limited") {
      return NextResponse.json(
        { error: "Too many attempts. Wait a few minutes and try again." },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  const { user } = result;
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
