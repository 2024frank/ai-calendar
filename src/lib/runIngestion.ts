import "server-only";
import { and, eq, gt, isNull, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { runs } from "@/db/schema";

function changed(result: unknown) {
  return Number((result as { affectedRows?: number })?.affectedRows ?? 0) === 1;
}

/** Both callback and returned model output compete for this same single claim. */
export async function claimRunIngestion(runId: number, deadlineAt: number, nowMs = Date.now()) {
  if (deadlineAt <= nowMs) return false;
  const [result] = await db.update(runs).set({
    phase: "ingesting",
    deadlineAt: new Date(deadlineAt),
  }).where(and(
    eq(runs.id, runId),
    eq(runs.status, "running"),
    gt(runs.deadlineAt, new Date(nowMs)),
    or(isNull(runs.phase), ne(runs.phase, "ingesting")),
  ));
  return changed(result);
}

/** A timeout can leave a callback pending, but must not replace its active claim. */
export async function markRunAwaitingCallback(runId: number, nowMs = Date.now()) {
  const [result] = await db.update(runs).set({ phase: "awaiting_callback" }).where(and(
    eq(runs.id, runId),
    eq(runs.status, "running"),
    gt(runs.deadlineAt, new Date(nowMs)),
    or(isNull(runs.phase), ne(runs.phase, "ingesting")),
  ));
  return changed(result);
}

/** Only the ingestion owner can fail an ingesting run; terminal results survive. */
export async function failActiveRun(runId: number, reason: string, ownsIngestion = false) {
  const [result] = await db.update(runs).set({
    status: "failed", phase: "done", finishedAt: new Date(), errorLog: { reason },
  }).where(and(
    eq(runs.id, runId),
    eq(runs.status, "running"),
    ownsIngestion
      ? eq(runs.phase, "ingesting")
      : or(isNull(runs.phase), ne(runs.phase, "ingesting")),
  ));
  return changed(result);
}

export async function completeRunIngestion(
  runId: number,
  counts: { found: number; inserted: number; duplicate: number; invalid: number },
) {
  const [result] = await db.update(runs).set({
    status: "completed", phase: "done", finishedAt: new Date(),
    eventsFound: counts.found, eventsExtracted: counts.inserted,
    eventsDuplicate: counts.duplicate, eventsInvalid: counts.invalid,
  }).where(and(eq(runs.id, runId), eq(runs.status, "running"), eq(runs.phase, "ingesting")));
  return changed(result);
}
