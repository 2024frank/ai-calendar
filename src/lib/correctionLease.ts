import "server-only";
import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { events, publishSubmissions } from "@/db/schema";

type EventRow = typeof events.$inferSelect;
export type CorrectionLease = { event: EventRow; token: string };
const publicationStates = ["sending", "accepted_unreconciled", "succeeded"] as const;
const retryAfterMs = 6 * 60_000;

function contentSnapshot(event: EventRow) {
  return JSON.stringify(Object.fromEntries(Object.entries(event).filter(([key]) => !key.startsWith("correction") && key !== "updatedAt")));
}

/** Both worker and reviewer must acquire this lease before calling a model. */
export async function claimCorrection(
  eventId: number,
  communityId: number,
  note: string,
  options: { automatic?: boolean } = {},
): Promise<CorrectionLease | null> {
  return db.transaction(async tx => {
    const [event] = await tx.select().from(events)
      .where(and(eq(events.id, eventId), eq(events.communityId, communityId))).limit(1).for("update");
    if (!event || !(options.automatic ? ["auto_rejected"] : ["pending", "auto_rejected"]).includes(event.status)) return null;
    if (event.correctionState === "running" && (options.automatic || !event.correctionRequestedAt || Date.now() - event.correctionRequestedAt.getTime() < retryAfterMs)) return null;
    const [sent] = await tx.select({ id: publishSubmissions.id }).from(publishSubmissions)
      .where(and(eq(publishSubmissions.eventId, eventId), inArray(publishSubmissions.state, [...publicationStates]))).limit(1).for("update");
    if (sent) return null;
    const token = randomUUID();
    await tx.update(events).set({
      correctionRequest: note, correctionState: "running", correctionError: null,
      correctionRequestedAt: new Date(), correctionLeaseToken: token,
    }).where(eq(events.id, eventId));
    return { event, token };
  });
}

/** A late model response cannot overwrite a new lease, edit, or rejection. */
export async function persistCorrection(lease: CorrectionLease, patch: Partial<EventRow>): Promise<void> {
  await db.transaction(async tx => {
    const [current] = await tx.select().from(events)
      .where(and(eq(events.id, lease.event.id), eq(events.communityId, lease.event.communityId))).limit(1).for("update");
    if (!current || current.correctionState !== "running" || current.correctionLeaseToken !== lease.token || contentSnapshot(current) !== contentSnapshot(lease.event)) {
      throw new Error("The event changed while correction ran. Your newer edits were preserved; review them before retrying.");
    }
    const [sent] = await tx.select({ id: publishSubmissions.id }).from(publishSubmissions)
      .where(and(eq(publishSubmissions.eventId, current.id), inArray(publishSubmissions.state, [...publicationStates]))).limit(1).for("update");
    if (sent) throw new Error("This event has a sent or unresolved publication. No correction was applied.");
    await tx.update(events).set({ ...patch, status: "pending", correctionState: "completed", correctionError: null, correctionLeaseToken: null })
      .where(eq(events.id, current.id));
  });
}

/** Release only our token. Optional automatic parking cannot replace a manual reason. */
export async function failCorrection(lease: CorrectionLease, error: string, markTried = false): Promise<void> {
  await db.transaction(async tx => {
    const [current] = await tx.select().from(events).where(eq(events.id, lease.event.id)).limit(1).for("update");
    if (!current || current.correctionState !== "running" || current.correctionLeaseToken !== lease.token) return;
    const unchanged = contentSnapshot(current) === contentSnapshot(lease.event);
    await tx.update(events).set({
      correctionState: "failed", correctionError: error.slice(0, 1000), correctionLeaseToken: null,
      ...(markTried && unchanged ? { rejectionReason: `${current.rejectionReason ?? "Auto-rejected (incomplete)"} [tried]` } : {}),
    }).where(eq(events.id, current.id));
  });
}
