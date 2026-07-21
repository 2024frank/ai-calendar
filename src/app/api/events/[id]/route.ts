import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { refreshPendingFlag } from "@/lib/flags";
import { recordFieldEdits, type FieldChange } from "@/lib/learning";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT_FIELDS = [
  "title",
  "description",
  "extendedDescription",
  "location",
  "locationType",
  "placeName",
  "roomNum",
  "geoScope",
  "urlLink",
  "displayType",
  "website",
  "registrationUrl",
  "imageCdnUrl",
  "contactEmail",
  "phone",
  "calendarSourceName",
  "calendarSourceUrl",
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

  if (Array.isArray(body.screensIds)) {
    const next = (body.screensIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const prev = (ev.screensIds ?? []) as number[];
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      patch.screensIds = next;
      changes.push({ field: "screensIds", oldValue: JSON.stringify(prev), newValue: JSON.stringify(next) });
    }
  }

  if (Array.isArray(body.buttons)) {
    const next = (body.buttons as { title?: unknown; link?: unknown }[])
      .map((b) => ({ title: String(b.title ?? "").trim(), link: String(b.link ?? "").trim() }))
      .filter((b) => b.title && b.link);
    const prev = (ev.buttons ?? []) as { title: string; link: string }[];
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      patch.buttons = next;
      changes.push({ field: "buttons", oldValue: JSON.stringify(prev), newValue: JSON.stringify(next) });
    }
  }

  if (Array.isArray(body.sessions)) {
    const next = (body.sessions as { startTime?: unknown; endTime?: unknown }[])
      .map((s) => {
        const startTime = Number(s.startTime);
        let endTime = Number(s.endTime);
        // A missing, inverted, or equal end defaults to two hours after the start.
        if (!Number.isFinite(endTime) || endTime <= startTime) endTime = startTime + 2 * 3600;
        return { startTime, endTime };
      })
      .filter((s) => Number.isFinite(s.startTime) && s.startTime > 0);
    const prev = (ev.sessions ?? []) as { startTime: number; endTime: number }[];
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      patch.sessions = next;
      // Keep the expiry sweep and the queue's "when" column in sync.
      patch.startTimeMax = next.length ? Math.max(...next.map((s) => s.startTime)) : null;
      changes.push({ field: "sessions", oldValue: JSON.stringify(prev), newValue: JSON.stringify(next) });
    }
  }

  if (!Object.keys(patch).length) {
    // Even a no-op save refreshes the stale "needs fields" flag.
    await refreshPendingFlag(ev.id);
    return NextResponse.json({ ok: true, changed: 0 });
  }

  await db.update(events).set(patch).where(eq(events.id, ev.id));
  await recordFieldEdits(ev.id, ev.sourceId, changes, s.uid);
  // The flag reflects what is saved NOW, so completing an event clears its tag.
  await refreshPendingFlag(ev.id);
  if (changes.length) {
    await logActivity({
      action: "edit",
      actorUserId: s.uid,
      actorEmail: s.email,
      targetType: "event",
      targetId: ev.id,
      summary: `Edited ${changes.length} field(s) on "${(ev.title ?? "untitled").slice(0, 60)}"`,
      detail: { fields: changes.map((c) => c.field) },
    });
  }

  return NextResponse.json({ ok: true, changed: changes.length });
}
