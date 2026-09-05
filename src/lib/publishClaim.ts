import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, publishSubmissions } from "@/db/schema";

type Input = {
  eventId: number;
  destinationId: number;
  payloadHash: string;
  payload: Record<string, unknown>;
};

export type PublicationClaim =
  | { kind: "claimed"; submissionId: number }
  | { kind: "unresolved" }
  | { kind: "missing" }
  | { kind: "already_sent"; remoteId: string | null; payloadChanged: boolean };

export async function claimPublication(input: Input): Promise<PublicationClaim> {
  return db.transaction(async (tx) => {
    // Serialize different payloads too: the payload-level unique index alone
    // cannot stop an edit from racing an older send for the same event.
    const [event] = await tx.select({ id: events.id }).from(events)
      .where(eq(events.id, input.eventId)).limit(1).for("update");
    if (!event) return { kind: "missing" };
    const history = await tx.select({
      id: publishSubmissions.id, state: publishSubmissions.state,
      payloadHash: publishSubmissions.payloadHash, externalPostId: publishSubmissions.externalPostId,
    }).from(publishSubmissions).where(and(
      eq(publishSubmissions.eventId, input.eventId),
      eq(publishSubmissions.destinationId, input.destinationId),
    )).for("update");
    if (history.some((attempt) => attempt.state === "sending" || attempt.state === "accepted_unreconciled")) {
      return { kind: "unresolved" };
    }
    const sent = history.find((attempt) => attempt.state === "succeeded");
    if (sent) return { kind: "already_sent", remoteId: sent.externalPostId, payloadChanged: sent.payloadHash !== input.payloadHash };
    const prior = history.find((attempt) => attempt.payloadHash === input.payloadHash);
    if (prior) {
      await tx.update(publishSubmissions).set({ state: "sending", error: null }).where(eq(publishSubmissions.id, prior.id));
      return { kind: "claimed", submissionId: prior.id };
    }
    const [inserted] = await tx.insert(publishSubmissions).values({ ...input, state: "sending" });
    const submissionId = Number((inserted as { insertId?: number }).insertId);
    if (!Number.isSafeInteger(submissionId) || submissionId < 1) throw new Error("Publish claim did not return an id.");
    return { kind: "claimed", submissionId };
  });
}
