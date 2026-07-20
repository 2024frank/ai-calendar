import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { pendingCount } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live count for the nav badge, so it is never stale. */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ count: 0 }, { status: 401 });
  return NextResponse.json(
    { count: await pendingCount(s) },
    { headers: { "cache-control": "no-store" } },
  );
}
