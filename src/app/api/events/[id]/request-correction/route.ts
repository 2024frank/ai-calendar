import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { requestEventCorrection } from "@/lib/correctionRequest";
import { readJsonObjectBody } from "@/lib/requestBody";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, {params}: {params:Promise<{id:string}>}) {
  const session = await getSession();
  if (!session) return NextResponse.json({error:"unauthorized"},{status:401});
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({error:"not found"},{status:404});
  const event = await getEventScoped(session,id);
  if (!event) return NextResponse.json({error:"not found"},{status:404});
  const parsed = await readJsonObjectBody(req,8192);
  if (!parsed.ok) return NextResponse.json({error:parsed.error},{status:parsed.status});
  const note = typeof parsed.body.note === "string" ? parsed.body.note.trim() : "";
  if (!note || note.length > 1000) return NextResponse.json({error:"A correction request of 1–1000 characters is required."},{status:400});
  const result = await requestEventCorrection(event.id,event.communityId,note);
  await logActivity({action:"edit",actorUserId:session.uid,actorEmail:session.email,targetType:"event",targetId:event.id,summary:result.message.slice(0,300),detail:{command:"request_correction",note,ok:result.ok}});
  return NextResponse.json({ok:result.ok,message:result.message,...(!result.ok ? {error:result.message} : {})},{status:result.status});
}
