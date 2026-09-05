import "server-only";
import { createHash } from "crypto";
import { isDeepStrictEqual } from "node:util";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { events, publishSubmissions } from "@/db/schema";

type Input = {
  eventId: number;
  destinationId: number;
  payloadHash: string;
  payload: Record<string, unknown>;
  operation?: "create" | "update";
  destinationSubmitUrl?: string;
};

export type PublicationClaim =
  | { kind: "claimed"; submissionId: number; remoteId?: string; patch?: Record<string, unknown> }
  | { kind: "not_linked" }
  | { kind: "unchanged"; remoteId: string }
  | { kind: "unresolved" }
  | { kind: "missing" }
  | { kind: "already_sent"; remoteId: string | null; payloadChanged: boolean };

export async function claimPublication(input: Input): Promise<PublicationClaim> {
  return db.transaction(async (tx) => {
    // Serialize different payloads too: the payload-level unique index alone
    // cannot stop an edit from racing an older send for the same event.
    const [event] = await tx.select({ id: events.id, correctionState: events.correctionState }).from(events)
      .where(eq(events.id, input.eventId)).limit(1).for("update");
    if (!event) return { kind: "missing" };
    if (event.correctionState === "running") return { kind: "unresolved" };
    const history = await tx.select({
      id: publishSubmissions.id, state: publishSubmissions.state,
      payloadHash: publishSubmissions.payloadHash, externalPostId: publishSubmissions.externalPostId,
      payload: publishSubmissions.payload, operation: publishSubmissions.operation,
      destinationId: publishSubmissions.destinationId,
      destinationSubmitUrl: publishSubmissions.destinationSubmitUrl,
    }).from(publishSubmissions).where(eq(publishSubmissions.eventId, input.eventId)).orderBy(desc(publishSubmissions.id)).for("update");
    if (history.some((attempt) => attempt.state === "sending" || attempt.state === "accepted_unreconciled")) {
      return { kind: "unresolved" };
    }
    const atDestination = history.filter(attempt => attempt.destinationId === input.destinationId);
    const sent = (input.operation === "update" ? atDestination : history).find((attempt) => attempt.state === "succeeded");
    if (input.operation === "update") {
      // Only the stored destination history links us to a remote post. No URL
      // or remote id from a browser is accepted here.
      if (!sent?.externalPostId || !/^[1-9]\d*$/.test(sent.externalPostId) ||
          !input.destinationSubmitUrl || sent.destinationSubmitUrl !== input.destinationSubmitUrl) return { kind: "not_linked" };
      const previous = (sent.payload ?? {}) as Record<string, unknown>;
      const patch = Object.fromEntries(Object.entries(input.payload).filter(([key, value]) =>
        !["public", "subscribe", "email"].includes(key) &&
        !(previous[key] == null && (value === "" || (Array.isArray(value) && value.length === 0))) &&
        !isDeepStrictEqual(previous[key], value),
      ));
      if (!Object.keys(patch).length) return { kind: "unchanged", remoteId: sent.externalPostId };
      // Include the base version: A -> B -> A is a new intentional update,
      // while a retry against the same version reuses its existing claim.
      const payloadHash = createHash("sha256").update(`update:${sent.id}:${JSON.stringify(input.payload)}`).digest("hex");
      const prior = atDestination.find(attempt => attempt.payloadHash === payloadHash);
      let submissionId: number;
      if (prior) {
        await tx.update(publishSubmissions).set({ state: "sending", error: null }).where(eq(publishSubmissions.id, prior.id));
        submissionId = prior.id;
      } else {
        const [inserted] = await tx.insert(publishSubmissions).values({
          eventId: input.eventId, destinationId: input.destinationId, payloadHash,
          payload: input.payload, operation: "update", state: "sending", externalPostId: sent.externalPostId,
          destinationSubmitUrl: input.destinationSubmitUrl,
        });
        submissionId = Number((inserted as { insertId?: number }).insertId);
        if (!Number.isSafeInteger(submissionId) || submissionId < 1) throw new Error("Update claim did not return an id.");
      }
      return { kind: "claimed", submissionId, remoteId: sent.externalPostId, patch };
    }
    if (sent) return { kind: "already_sent", remoteId: sent.externalPostId, payloadChanged: sent.payloadHash !== input.payloadHash };
    const prior = atDestination.find((attempt) => attempt.payloadHash === input.payloadHash);
    if (prior) {
      // Only a definitely unsent attempt can reach this branch. A destination
      // row may have been reconfigured since that failure, so record the
      // endpoint this retry will actually contact before sending it.
      await tx.update(publishSubmissions).set({
        state: "sending", error: null,
        destinationSubmitUrl: input.destinationSubmitUrl ?? null,
      }).where(eq(publishSubmissions.id, prior.id));
      return { kind: "claimed", submissionId: prior.id };
    }
    const [inserted] = await tx.insert(publishSubmissions).values({ ...input, state: "sending" });
    const submissionId = Number((inserted as { insertId?: number }).insertId);
    if (!Number.isSafeInteger(submissionId) || submissionId < 1) throw new Error("Publish claim did not return an id.");
    return { kind: "claimed", submissionId };
  });
}
