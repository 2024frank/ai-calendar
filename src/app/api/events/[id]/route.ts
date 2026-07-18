import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { recordFieldEdits, type FieldChange } from "@/lib/learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT_FIELDS = [
  "title",
  "description",
  "extendedDescription",
  "location",
  "locationType",
  "urlLink",
  "website",
  "registrationUrl",
  "contactEmail",
  "phone",
  "eventType",
] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ev = await getEventScoped(s, Number(id));
  if (!ev) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ event: ev });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ev = await getEventScoped(s, Number(id));
  if (!ev) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const changes: FieldChange[] = [];

  for (const f of TEXT_FIELDS) {
    if (!(f in body)) continue;
    const next = body[f] === null || body[f] === "" ? null : String(body[f]);
    const prev = (ev as Record<string, unknown>)[f] as string | null;
    if ((prev ?? "") !== (next ?? "")) {
      patch[f] = next;
      changes.push({ field: f, oldValue: prev ?? null, newValue: next });
    }
  }

  if (Array.isArray(body.postTypeIds)) {
    const next = (body.postTypeIds as unknown[]).map(Number).filter(Number.isFinite);
    const prev = (ev.postTypeIds ?? []) as number[];
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      patch.postTypeIds = next;
      changes.push({
        field: "postTypeIds",
        oldValue: JSON.stringify(prev),
        newValue: JSON.stringify(next),
      });
    }
  }
  if (Array.isArray(body.sponsors)) {
    const next = (body.sponsors as unknown[]).map((x) => String(x).trim()).filter(Boolean);
    const prev = (ev.sponsors ?? []) as string[];
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      patch.sponsors = next;
      changes.push({
        field: "sponsors",
        oldValue: JSON.stringify(prev),
        newValue: JSON.stringify(next),
      });
    }
  }

  if (!Object.keys(patch).length) return NextResponse.json({ ok: true, changed: 0 });

  await db.update(events).set(patch).where(eq(events.id, ev.id));
  await recordFieldEdits(ev.id, ev.sourceId, changes, s.uid);

  return NextResponse.json({ ok: true, changed: changes.length });
}
