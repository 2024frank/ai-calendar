import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { evaluations, sources } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/auth";
import { currentCommunityId } from "@/lib/data";
import { compareEvaluation, MAX_EVALUATION_BYTES, validateEvaluation } from "@/lib/evaluation";
import { readJsonObjectBody } from "@/lib/requestBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const communityId = await currentCommunityId(session);
  if (!communityId) return NextResponse.json({ error: "Select an authorized community" }, { status: 403 });
  const rows = await db.select({ id: evaluations.id, title: evaluations.title, sourceId: evaluations.sourceId, createdAt: evaluations.createdAt, periodStart: evaluations.periodStart, periodEnd: evaluations.periodEnd })
    .from(evaluations).where(eq(evaluations.communityId, communityId)).orderBy(desc(evaluations.id)).limit(100);
  return NextResponse.json({ evaluations: rows }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const communityId = await currentCommunityId(session);
  if (!communityId) return NextResponse.json({ error: "Select an authorized community" }, { status: 403 });
  const body = await readJsonObjectBody(req, MAX_EVALUATION_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });
  let input;
  try { input = validateEvaluation(body.body); }
  catch (error) {
    // Validation errors contain paths and rules only; never echo uploaded records.
    return NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 1000) : "Invalid evaluation" }, { status: 400 });
  }
  const [source] = await db.select({ id: sources.id }).from(sources).where(and(eq(sources.id, input.sourceId), eq(sources.communityId, communityId))).limit(1);
  if (!source) return NextResponse.json({ error: "Source not found in this community" }, { status: 404 });
  const report = compareEvaluation(input);
  const [result] = await db.insert(evaluations).values({
    communityId, sourceId: source.id, createdBy: session.uid, title: input.title, version: input.version,
    creator: { id: session.uid, email: session.email, name: session.name },
    periodStart: new Date(input.period.start), periodEnd: new Date(input.period.end),
    provenance: input.provenance, snapshot: input, confirmedMatches: input.matches, report,
  });
  return NextResponse.json({ id: (result as { insertId: number }).insertId, report }, { status: 201 });
}
