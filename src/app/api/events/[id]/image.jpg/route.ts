import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves an image we built ourselves (e.g. the merged Apollo posters).
 * Public once the event itself is public. Draft/rejected images remain behind
 * the same tenant check as the review UI.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  const [row] = await db
    .select({ data: events.imageData, status: events.status })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!row?.data) return new Response("Not found", { status: 404 });
  if (!["approved", "submitted", "published"].includes(row.status)) {
    const session = await getSession();
    if (!session || !(await getEventScoped(session, eventId))) {
      return new Response("Not found", { status: 404 });
    }
  }

  const bytes = Buffer.from(row.data, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(bytes.byteLength),
      "cache-control": "public, max-age=3600",
    },
  });
}
