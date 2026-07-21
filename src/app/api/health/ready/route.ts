import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { productionConfigIssues } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness verifies configuration and the critical synchronous dependency. */
export async function GET() {
  const issues = productionConfigIssues();
  let database = "ok";
  try {
    await db.execute(sql`select 1`);
  } catch {
    database = "unavailable";
    issues.push("database is unavailable");
  }

  const ok = issues.length === 0;
  return NextResponse.json(
    { ok, checks: { database, configuration: issues.length ? issues : "ok" } },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
