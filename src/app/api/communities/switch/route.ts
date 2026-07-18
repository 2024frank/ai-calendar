import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { accessibleCommunities } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Switch which community the user is working in. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { communityId?: unknown };
  const communityId = Number(body.communityId);
  if (!Number.isInteger(communityId)) {
    return NextResponse.json({ error: "A community is required." }, { status: 400 });
  }

  // Only ever switch into a community this user actually belongs to.
  const allowed = await accessibleCommunities(s);
  if (!allowed.some((c) => c.id === communityId)) {
    return NextResponse.json({ error: "You do not have access to that community." }, { status: 403 });
  }

  (await cookies()).set("ac_community", String(communityId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return NextResponse.json({ ok: true, communityId });
}
