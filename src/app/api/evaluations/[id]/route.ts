import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { evaluations } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/auth";
import { currentCommunityId } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read or download the retained snapshot; deliberately no edit/delete endpoints. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const communityId = await currentCommunityId(session);
  if (!communityId) return NextResponse.json({ error: "Select an authorized community" }, { status: 403 });
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return NextResponse.json({ error: "Invalid evaluation ID" }, { status: 400 });
  const [row] = await db.select().from(evaluations).where(and(eq(evaluations.id, Number(id)), eq(evaluations.communityId, communityId))).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const headers: Record<string, string> = { "cache-control": "private, no-store" };
  if (new URL(req.url).searchParams.get("download") === "1") headers["content-disposition"] = `attachment; filename="evaluation-${row.id}.json"`;
  return NextResponse.json(row, { headers });
}
