import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, sources } from "@/db/schema";
import { getSession, isAdmin } from "@/lib/auth";
import { currentCommunityId } from "@/lib/data";
import { buildEvaluationDraft } from "@/lib/evaluationDraft";
import { fetchDestinationInventory } from "@/lib/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 86_400_000;
const MAX_PERIOD_DAYS = 120;

function parseDay(value: string | null, fallback: Date): Date | null {
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Draft a comparison for a person to check; nothing is retained here. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const communityId = await currentCommunityId(session);
  if (!communityId) return NextResponse.json({ error: "Select an authorized community" }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const sourceId = Number(params.get("sourceId"));
  if (!Number.isInteger(sourceId) || sourceId <= 0) return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
  const today = new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS);
  const start = parseDay(params.get("start"), today);
  const end = parseDay(params.get("end"), new Date(today.getTime() + 30 * DAY_MS));
  if (!start || !end) return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  if (end <= start || end.getTime() - start.getTime() > MAX_PERIOD_DAYS * DAY_MS) {
    return NextResponse.json({ error: `The period must end after it starts and span at most ${MAX_PERIOD_DAYS} days` }, { status: 400 });
  }

  const [source] = await db
    .select({ id: sources.id, name: sources.name, orgName: sources.orgName, calendarSourceName: sources.calendarSourceName })
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.communityId, communityId)))
    .limit(1);
  if (!source) return NextResponse.json({ error: "Source not found in this community" }, { status: 404 });

  const inventory = await fetchDestinationInventory(communityId, source.id, 25_000);
  const ours = await db
    .select({
      id: events.id, title: events.title, status: events.status, sessions: events.sessions,
      location: events.location, calendarSourceUrl: events.calendarSourceUrl, website: events.website,
    })
    .from(events)
    .where(and(eq(events.communityId, communityId), eq(events.sourceId, source.id)))
    .limit(2000);

  const organizationNames = [...new Set([source.orgName, source.calendarSourceName, source.name].filter((n): n is string => Boolean(n)))];
  const draft = buildEvaluationDraft(
    { sourceId: source.id, sourceName: source.name, organizationNames, period: { start, end }, capturedAt: new Date(), inventoryAvailable: inventory.available },
    inventory.items,
    ours,
  );
  if (!inventory.available && inventory.reason) draft.notes.unshift(inventory.reason);
  return NextResponse.json(draft, { headers: { "cache-control": "private, no-store" } });
}
