import { NextResponse } from "next/server";
import { and, desc, eq, inArray, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { events, learnings, publishSubmissions } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { logActivity } from "@/lib/activity";
import { readJsonObjectBody } from "@/lib/requestBody";
import {
  parsePublishReconciliationOutcome,
  publishSubmissionCanBeReconciled,
  reconciliationTransition,
  SENDING_RECONCILIATION_DELAY_MS,
  UNRESOLVED_PUBLISH_STATES,
} from "@/lib/publishReconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function affectedRows(result: unknown): number {
  return Number((result as { affectedRows?: number })?.affectedRows ?? 0);
}

/**
 * Resolve the latest ambiguous destination send for one event.
 *
 * Body: { outcome: "published" | "not_published" }
 * - published: the reviewer verified the remote post exists.
 * - not_published: the reviewer verified it does not exist, enabling safe retry.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const eventId = Number(id);
  if (!Number.isInteger(eventId) || eventId < 1) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // This is the same tenant/source boundary used by review, edit, reject, and
  // approve. A caller outside the selected community receives no existence leak.
  const event = await getEventScoped(session, eventId);
  if (!event) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = await readJsonObjectBody(req,8192);
  if (!parsed.ok) return NextResponse.json({error:parsed.error},{status:parsed.status});
  const body = parsed.body;
  const outcome = parsePublishReconciliationOutcome(body.outcome);
  if (!outcome) {
    return NextResponse.json(
      { error: 'outcome must be "published" or "not_published"' },
      { status: 400 },
    );
  }

  const transition = reconciliationTransition(outcome);
  const reconciledAt = new Date();
  const result = await db.transaction(async (tx) => {
    // Match claimPublication's event -> submission order. Locking a submission
    // first can deadlock against a publisher waiting on that same submission.
    const [currentEvent] = await tx
      .select({ id: events.id, status: events.status })
      .from(events)
      .where(eq(events.id, event.id))
      .limit(1)
      .for("update");
    if (!currentEvent) return null;

    const [submission] = await tx
      .select({
        id: publishSubmissions.id,
        state: publishSubmissions.state,
        destinationId: publishSubmissions.destinationId,
        payloadHash: publishSubmissions.payloadHash,
        updatedAt: publishSubmissions.updatedAt,
        operation: publishSubmissions.operation,
      })
      .from(publishSubmissions)
      .where(
        and(
          eq(publishSubmissions.eventId, event.id),
          inArray(publishSubmissions.state, [...UNRESOLVED_PUBLISH_STATES]),
        ),
      )
      .orderBy(desc(publishSubmissions.updatedAt), desc(publishSubmissions.id))
      .limit(1)
      .for("update");

    if (!submission) return null;
    if (submission.operation === "update" && body.operation !== "update") return { wrongOperation: true as const };
    if (!publishSubmissionCanBeReconciled(submission.state, submission.updatedAt, reconciledAt.getTime())) {
      return { active: true as const };
    }

    const staleSendingBefore = new Date(
      reconciledAt.getTime() - SENDING_RECONCILIATION_DELAY_MS,
    );

    const [claimed] = await tx
      .update(publishSubmissions)
      .set({
        state: transition.submissionState,
        error:
          outcome === "not_published"
            ? {
                reconciledOutcome: outcome,
                reconciledAt: reconciledAt.toISOString(),
                reconciledByUserId: session.uid,
              }
            : null,
      })
      .where(
        and(
          eq(publishSubmissions.id, submission.id),
          eq(publishSubmissions.eventId, event.id),
          or(
            eq(publishSubmissions.state, "accepted_unreconciled"),
            and(
              eq(publishSubmissions.state, "sending"),
              lte(publishSubmissions.updatedAt, staleSendingBefore),
            ),
          ),
        ),
      );

    // A second reviewer resolved this row after our read. Never overwrite their
    // decision or apply a contradictory event transition.
    if (affectedRows(claimed) !== 1) return { conflict: true as const };

    if (transition.eventStatus && submission.operation !== "update") {
      await tx
        .update(events)
        .set({
          status: transition.eventStatus,
          publishedVia: "reviewer",
          rejectionReason: null,
        })
        .where(eq(events.id, event.id));

      // Match normal approval semantics when this reverses a rejection.
      if (currentEvent.status === "rejected" || currentEvent.status === "auto_rejected") {
        await tx
          .update(learnings)
          .set({ status: "retired" })
          .where(
            and(
              eq(learnings.eventId, event.id),
              eq(learnings.triggerKind, "rejection"),
              eq(learnings.status, "active"),
            ),
          );
      }
    }

    return {
      conflict: false as const,
      submissionId: submission.id,
      destinationId: submission.destinationId,
      payloadHash: submission.payloadHash,
      operation: submission.operation ?? "create",
      eventStatus: submission.operation === "update" ? currentEvent.status : transition.eventStatus ?? currentEvent.status,
    };
  });

  if (!result) {
    return NextResponse.json(
      { error: "No unresolved publish submission exists for this event." },
      { status: 409 },
    );
  }
  if ("active" in result && result.active) {
    return NextResponse.json(
      { error: "This submission may still be sending. Wait two minutes, then verify it in CommunityHub." },
      { status: 409 },
    );
  }
  if ("wrongOperation" in result) return NextResponse.json({error:"Verify whether the requested content update was applied, not merely whether the post exists. Refresh and use update reconciliation."},{status:409});
  if (result.conflict) {
    return NextResponse.json(
      { error: "This publish submission was already reconciled. Refresh and try again." },
      { status: 409 },
    );
  }

  await logActivity({
    action: outcome === "published" && result.operation !== "update" ? "approve" : "edit",
    actorUserId: session.uid,
    actorEmail: session.email,
    targetType: "event",
    targetId: event.id,
    summary:
      result.operation === "update"
        ? `Confirmed CommunityHub content update ${outcome === "published" ? "applied" : "not applied"} for event #${event.id}`
        : outcome === "published"
        ? `Confirmed CommunityHub published "${(event.title ?? "untitled").slice(0, 80)}"`
        : `Confirmed CommunityHub did not publish "${(event.title ?? "untitled").slice(0, 80)}"; retry enabled`,
    detail: {
      reconciliation: outcome,
      operation: result.operation,
      submissionId: result.submissionId,
      destinationId: result.destinationId,
      payloadHash: result.payloadHash,
    },
  });

  return NextResponse.json({
    ok: true,
    eventId: event.id,
    submissionId: result.submissionId,
    outcome,
    submissionState: transition.submissionState,
    eventStatus: result.eventStatus,
    operation: result.operation,
    retryEnabled: outcome === "not_published",
  });
}
