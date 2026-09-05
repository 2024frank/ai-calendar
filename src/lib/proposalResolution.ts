import "server-only";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { events } from "@/db/schema";

export type ProposalResolutionResult =
  | {
      ok: true;
      eventId: number;
      originalEventId: number;
      proposalResolvedAt: string;
      alreadyResolved: boolean;
    }
  | { ok: false; message: string };

function affectedRows(result: unknown): number {
  return Number((result as { affectedRows?: number })?.affectedRows ?? 0);
}

/** Mark recurrence-proposal bookkeeping complete without teaching a rejection. */
export async function resolveProposal(
  eventId: number,
  communityId: number,
  now = new Date(),
): Promise<ProposalResolutionResult> {
  return db.transaction(async (tx) => {
    const [proposal] = await tx
      .select({
        id: events.id,
        status: events.status,
        originalEventId: events.proposedUpdateOfEventId,
        resolvedAt: events.proposalResolvedAt,
      })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.communityId, communityId)))
      .limit(1)
      .for("update");

    if (!proposal) {
      return { ok: false, message: "This proposal no longer exists. Refresh and try again." };
    }
    if (!proposal.originalEventId) {
      return { ok: false, message: "This event is not a recurrence update proposal." };
    }

    const [original] = await tx
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.id, proposal.originalEventId), eq(events.communityId, communityId)))
      .limit(1)
      .for("update");
    if (!original) {
      return {
        ok: false,
        message: "The original event for this proposal is unavailable in this community.",
      };
    }
    if (proposal.resolvedAt) {
      return {
        ok: true,
        eventId: proposal.id,
        originalEventId: proposal.originalEventId,
        proposalResolvedAt: proposal.resolvedAt.toISOString(),
        alreadyResolved: true,
      };
    }
    if (proposal.status !== "pending") {
      return {
        ok: false,
        message: "Only a pending recurrence update proposal can be marked resolved.",
      };
    }

    const [result] = await tx
      .update(events)
      .set({ status: "duplicate", proposalResolvedAt: now })
      .where(
        and(
          eq(events.id, proposal.id),
          eq(events.communityId, communityId),
          eq(events.status, "pending"),
          isNotNull(events.proposedUpdateOfEventId),
          isNull(events.proposalResolvedAt),
        ),
      );
    if (affectedRows(result) !== 1) {
      return {
        ok: false,
        message: "This proposal changed while it was being resolved. Refresh and try again.",
      };
    }

    return {
      ok: true,
      eventId: proposal.id,
      originalEventId: proposal.originalEventId,
      proposalResolvedAt: now.toISOString(),
      alreadyResolved: false,
    };
  });
}
