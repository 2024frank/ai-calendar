import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Process liveness only; dependency outages must not trigger restart loops. */
export function GET() {
  return NextResponse.json(
    { ok: true, service: "ai-calendar", timestamp: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
