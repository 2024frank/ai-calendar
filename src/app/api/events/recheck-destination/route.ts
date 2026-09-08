import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { getSession, isAdmin } from "@/lib/auth";
import { currentCommunityId } from "@/lib/data";
import { recheckDestinationHolds } from "@/lib/destinationRecheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST: compare every held event in the current community against CommunityHub now. */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdmin(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const communityId = await currentCommunityId(session);
  if (!communityId) return NextResponse.json({ error: "Select an authorized community" }, { status: 403 });

  const result = await recheckDestinationHolds(communityId);
  if (!result.available) {
    return NextResponse.json({ error: result.reason ?? "CommunityHub could not be read; nothing was changed." }, { status: 503 });
  }
  if (result.checked) {
    await logActivity({
      action: "edit",
      actorUserId: session.uid,
      actorEmail: session.email,
      targetType: "community",
      targetId: communityId,
      summary: `Re-checked ${result.checked} held event(s) against CommunityHub: ${result.duplicates} already posted, ${result.cleared} released`,
      detail: { command: "recheck_destination", ...result },
    });
  }
  return NextResponse.json(result);
}
