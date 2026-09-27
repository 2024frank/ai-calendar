import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { refreshPendingFlag } from "@/lib/flags";
import { logActivity } from "@/lib/activity";
import { fitInlineImage } from "@/lib/mergePosters";
import { INLINE_IMAGE_FAILURE_TEXT } from "@/lib/inlineImage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Take a picture straight from the reviewer's computer. Some hosts put their
 * images behind a bot check that blocks every server (the Business
 * Partnership's locable.com CDN does), so no URL for those pictures can ever
 * be fetched from here. The reviewer's own browser can open them; this lets
 * them save the picture and hand it over directly.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ev = await getEventScoped(s, Number(id));
  if (!ev) return NextResponse.json({ error: "not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) {
    return NextResponse.json({ error: "Choose an image file to upload." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: INLINE_IMAGE_FAILURE_TEXT.too_large }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  const isGif = buf[0] === 0x47 && buf[1] === 0x49;
  const isWebp = buf.subarray(8, 12).toString() === "WEBP";
  if (!(isJpeg || isPng || isGif || isWebp)) {
    return NextResponse.json(
      { error: "Upload a JPEG, PNG, GIF or WEBP picture." },
      { status: 400 },
    );
  }
  const jpeg = await fitInlineImage(buf);
  if (!jpeg) return NextResponse.json({ error: INLINE_IMAGE_FAILURE_TEXT.unreadable }, { status: 400 });

  const appUrl = (process.env.APP_URL || new URL(req.url).origin).replace(/\/+$/, "");
  const hostedUrl = `${appUrl}/api/events/${ev.id}/image.jpg`;
  await db
    .update(events)
    .set({ imageData: jpeg.toString("base64"), imageCdnUrl: hostedUrl })
    .where(eq(events.id, ev.id));
  await refreshPendingFlag(ev.id);
  await logActivity({
    action: "edit",
    actorUserId: s.uid,
    actorEmail: s.email,
    targetType: "event",
    targetId: ev.id,
    summary: `Uploaded an image for "${(ev.title ?? "untitled").slice(0, 60)}"`,
    detail: { fields: ["imageCdnUrl"], upload: true },
  });
  return NextResponse.json({ ok: true, imageCdnUrl: hostedUrl });
}
