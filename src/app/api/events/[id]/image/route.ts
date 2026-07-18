import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves an image we built ourselves (e.g. the merged Apollo posters).
 * Public: an event picture is destined for a public calendar anyway, and the
 * id alone reveals nothing else about the event.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db
    .select({ data: events.imageData })
    .from(events)
    .where(eq(events.id, Number(id)))
    .limit(1);

  if (!row?.data) return new Response("Not found", { status: 404 });

  const bytes = Buffer.from(row.data, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(bytes.byteLength),
      "cache-control": "public, max-age=3600",
    },
  });
}
