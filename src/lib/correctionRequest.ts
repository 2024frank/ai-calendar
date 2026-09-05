import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, runs, sources } from "@/db/schema";
import { correctOne } from "./correction";
import { modelChain } from "./models";
import { claimCorrection, failCorrection, persistCorrection } from "./correctionLease";

type Result = { ok: boolean; status: number; message: string };

/** Exact-event, reviewer-triggered correction. Never approves or publishes. */
export async function requestEventCorrection(eventId: number, communityId: number, note: string): Promise<Result> {
  const lease = await claimCorrection(eventId, communityId, note);
  if (!lease) return { ok:false,status:409,message:"Only unsent events awaiting review can be corrected. A correction may already be running; wait six minutes before retrying an interrupted request." };
  const claim = lease.event;

  let runId: number | null = null;
  try {
    const [source] = claim.sourceId ? await db.select().from(sources).where(and(eq(sources.id,claim.sourceId),eq(sources.communityId,communityId))).limit(1) : [];
    if (!source) throw new Error("This event has no authorized source to check.");
    const [community] = await db.select().from(communities).where(eq(communities.id,communityId)).limit(1);
    const [run] = await db.insert(runs).values({ sourceId:source.id,communityId,runKind:"correction",status:"running",phase:"fetching" });
    runId = Number((run as { insertId:number }).insertId);
    const outcome = await correctOne(runId,claim,source,community ?? null,source.specialInstructions ?? "",await modelChain(),{
      request:note,
      persist: patch => persistCorrection(lease, patch),
    });
    if (outcome !== "fixed") throw new Error(outcome === "failed" ? "The correction service failed. The request is saved and can be retried." : "The source did not provide a complete supported correction. Edit manually or retry with a narrower request.");
    await db.update(runs).set({status:"completed",phase:"done",eventsFound:1,eventsExtracted:1,finishedAt:new Date()}).where(eq(runs.id,runId));
    return {ok:true,status:200,message:"Correction applied to this event and returned to review. Nothing was published; review the changed fields before approving."};
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Correction failed; retry is available.").slice(0,1000);
    await failCorrection(lease, message);
    if (runId) await db.update(runs).set({status:"failed",phase:"done",finishedAt:new Date()}).where(eq(runs.id,runId));
    return {ok:false,status:502,message};
  }
}
