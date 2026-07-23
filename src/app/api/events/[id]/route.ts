import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { refreshPendingFlag } from "@/lib/flags";
import { recordFieldEdits, type FieldChange } from "@/lib/learning";
import { learnFromCorrection } from "@/lib/learningAgent";
import { logActivity } from "@/lib/activity";
import { isPublicHttpUrl } from "@/lib/publicUrl";

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
const URL_FIELDS = new Set([
  "urlLink",
  "website",
  "registrationUrl",
  "imageCdnUrl",
  "calendarSourceUrl",
]);

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
    if (next && URL_FIELDS.has(f) && !isPublicHttpUrl(next)) {
      return NextResponse.json(
        { error: `${f} must use a public http or https address.` },
        { status: 400 },
      );
    }
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
    const submitted = (body.buttons as { title?: unknown; link?: unknown }[]).map((b) => ({
      title: String(b.title ?? "").trim(),
      link: String(b.link ?? "").trim(),
    }));
    if (submitted.some((button) => button.link && !isPublicHttpUrl(button.link))) {
      return NextResponse.json(
        { error: "Button links must use a public http or https address." },
        { status: 400 },
      );
    }
    const next = submitted.filter((b) => b.title && b.link);
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
    // Rebuild the stored rows in the same key order before comparing. MySQL
    // returns JSON keys alphabetically (endTime first), so comparing raw
    // stringifications called every save a change even when nothing moved.
    const prev = ((ev.sessions ?? []) as { startTime: number; endTime: number }[]).map(
      (row) => ({ startTime: row.startTime, endTime: row.endTime }),
    );
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
  // Learn from it in the background: the reviewer should not wait on an agent,
  // and a lesson failing to be written must never fail their save.
  after(async () => {
    for (const ch of changes.filter((c) => (c.oldValue ?? "") !== (c.newValue ?? ""))) {
      await learnFromCorrection({
        eventId: ev.id,
        sourceId: ev.sourceId,
        communityId: ev.communityId,
        reviewerId: s.uid,
        triggerKind: "edit",
        fieldName: ch.field,
        beforeValue: ch.oldValue,
        afterValue: ch.newValue,
        title: ev.title,
      }).catch(() => undefined);
    }
  });
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
