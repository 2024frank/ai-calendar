import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await clearSession();
  const base = process.env.APP_URL || new URL(req.url).origin;
  return NextResponse.redirect(new URL("/login", base), { status: 303 });
}
