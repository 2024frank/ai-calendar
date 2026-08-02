import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, events } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { imageMimeType } from "@/lib/imageData";
import { verifyImagePublishToken } from "@/lib/imagePublishToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves an image we built ourselves (e.g. the merged Apollo posters).
 * Public once the event itself is public. Draft/rejected images remain behind
 * the same tenant check as the review UI.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const eventId = Number(id);
  const [row] = await db
    .select({ data: events.imageData, status: events.status, communityStatus: communities.status })
    .from(events)
    .innerJoin(communities, eq(communities.id, events.communityId))
    .where(eq(events.id, eventId))
    .limit(1);

  if (!row?.data) return new Response("Not found", { status: 404 });
  const publiclyVisible =
    row.communityStatus === "active" &&
    ["approved", "submitted", "published"].includes(row.status);
  const signedPublishAccess =
    !publiclyVisible &&
    row.communityStatus === "active" &&
    verifyImagePublishToken(
      eventId,
      row.data,
      new URL(req.url).searchParams.get("publish_token"),
    );
  if (!publiclyVisible && !signedPublishAccess) {
    const session = await getSession();
    if (!session || !(await getEventScoped(session, eventId))) {
      return new Response("Not found", { status: 404 });
    }
  }

  const bytes = Buffer.from(row.data, "base64");
  const contentType = imageMimeType(bytes);
  if (!contentType) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
      "cache-control": publiclyVisible ? "public, max-age=3600" : "private, no-store",
    },
  });
}
