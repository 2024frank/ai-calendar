import "server-only";

import { randomUUID } from "crypto";
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs, runs } from "@/db/schema";
import { runExtraction } from "./agent";
import { hasDatabaseErrorCode } from "./dbError";
import {
  drainBatchSize,
  QUEUED_JOB_MAX_WAIT_MS,
  QUEUED_RUN_DEADLINE_MS,
  STALE_JOB_LEASE_MS,
  terminalJobStatus,
} from "./jobPolicy";

type EnqueuedRun = { jobId: number; runId: number; deduplicated: boolean };
type ClaimedJob = Pick<typeof jobs.$inferSelect, "id" | "runId" | "lockedAt" | "attempts">;

function isDuplicateKey(error: unknown) {
  return hasDatabaseErrorCode(error, "ER_DUP_ENTRY");
}

function affectedRows(result: unknown) {
  return Number((result as { affectedRows?: number })?.affectedRows ?? 0);
}

function ownedLease(job: ClaimedJob, workerId: string) {
  return and(
    eq(jobs.id, job.id),
    eq(jobs.status, "running"),
    eq(jobs.lockedBy, workerId),
    eq(jobs.attempts, job.attempts),
    job.lockedAt == null ? isNull(jobs.lockedAt) : eq(jobs.lockedAt, job.lockedAt),
  );
}

/** Persist execution start while the exact claim is locked against recovery. */
async function prepareOwnedJob(job: ClaimedJob, workerId: string) {
  return db.transaction(async (tx) => {
    const [owned] = await tx.select({ id: jobs.id }).from(jobs)
      .where(ownedLease(job, workerId)).limit(1).for("update");
    if (!owned) return false;
    // Job then run is the same lock order used by recovery/finalization. Once
    // this commits, recovery sees started work and can never reuse its run ID.
    const [prepared] = await tx.update(runs)
      .set({ phase: "fetching", deadlineAt: new Date(Date.now() + QUEUED_RUN_DEADLINE_MS) })
      .where(and(eq(runs.id, job.runId), eq(runs.status, "running"), eq(runs.phase, "queued")));
    return affectedRows(prepared) === 1;
  });
}

/** Close both records only while this invocation still owns the job. */
async function settleOwnedJob(
  job: ClaimedJob,
  workerId: string,
  failureMessage?: string,
) {
  return db.transaction(async (tx) => {
    const ownership = ownedLease(job, workerId);
    // Lock in job-then-run order, the same order used by lease recovery. An old
    // invocation must not change a run after another worker has taken over.
    const [owned] = await tx.select({ id: jobs.id }).from(jobs).where(ownership).limit(1).for("update");
    if (!owned) return false;

    const [run] = await tx
      .select({ status: runs.status, errorLog: runs.errorLog, phase: runs.phase, deadlineAt: runs.deadlineAt })
      .from(runs)
      .where(eq(runs.id, job.runId))
      .limit(1)
      .for("update");
    const terminal = run ? terminalJobStatus(run.status) : "failed";
    if (
      !terminal &&
      (run?.phase === "awaiting_callback" || run?.phase === "ingesting") &&
      run.deadlineAt && run.deadlineAt.getTime() > Date.now()
    ) {
      // The callback owns delivery now. Retain the job and its dedupe key so a
      // second extraction cannot overlap the still-active remote delivery.
      return false;
    }
    const succeeded = terminal === "succeeded";
    const message = failureMessage || JSON.stringify(run?.errorLog ?? { reason: "Extraction ended without completing the run." });

    if (run?.status === "running") {
      await tx.update(runs).set({
        status: "failed",
        phase: "done",
        finishedAt: new Date(),
        errorLog: { reason: message.slice(0, 4000) },
      }).where(and(eq(runs.id, job.runId), eq(runs.status, "running")));
    }
    await tx.update(jobs).set({
      status: succeeded ? "succeeded" : "failed",
      dedupeKey: null,
      lockedAt: null,
      lockedBy: null,
      lastError: succeeded ? null : message.slice(0, 4000),
    }).where(ownership);
    return succeeded;
  });
}

/**
 * Atomically create the user-visible run and its durable work item.
 *
 * The active dedupe key is unique, so concurrent cron ticks or button clicks
 * converge on one run even when they land on different server instances.
 */
export async function enqueueExtraction(
  sourceId: number,
  communityId: number,
): Promise<EnqueuedRun> {
  const dedupeKey = `extract-source:${sourceId}`;

  try {
    return await db.transaction(async (tx) => {
      const [runResult] = await tx.insert(runs).values({
        sourceId,
        communityId,
        runKind: "extraction",
        status: "running",
        phase: "queued",
        deadlineAt: new Date(Date.now() + QUEUED_RUN_DEADLINE_MS),
      });
      const runId = (runResult as { insertId: number }).insertId;

      const [jobResult] = await tx.insert(jobs).values({
        runId,
        kind: "extract_source",
        status: "queued",
        dedupeKey,
      });

      return {
        jobId: (jobResult as { insertId: number }).insertId,
        runId,
        deduplicated: false,
      };
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;

    const [existing] = await db
      .select({ id: jobs.id, runId: jobs.runId })
      .from(jobs)
      .where(eq(jobs.dedupeKey, dedupeKey))
      .limit(1);
    if (!existing) throw error;
    return { jobId: existing.id, runId: existing.runId, deduplicated: true };
  }
}

/** Claim and execute one job. A conditional update is the distributed lock. */
export async function processJob(jobId: number, workerId: string = randomUUID()): Promise<boolean> {
  const now = new Date();
  const [claim] = await db
    .update(jobs)
    .set({
      status: "running",
      lockedAt: now,
      lockedBy: workerId,
      attempts: sql`${jobs.attempts} + 1`,
      lastError: null,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "queued"),
        lte(jobs.availableAt, now),
      ),
    );

  if (affectedRows(claim) !== 1) return false;

  const [job] = await db.select().from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId), eq(jobs.lockedAt, now)))
    .limit(1);
  if (!job) return false;

  let failureMessage: string | undefined;
  try {
    if (await prepareOwnedJob(job, workerId)) {
      await runExtraction(job.runId);
    }
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : "Worker failed";
  }
  return settleOwnedJob(job, workerId, failureMessage);
}

/**
 * Recover claims abandoned before extraction started. Once execution starts,
 * close an expired worker's run instead: its sandbox may still possess that
 * run's callback token. A later retry must receive a new run ID and token.
 */
export async function requeueStaleJobs(now = new Date()) {
  // A queued job is allowed to wait, but not forever. If no worker has claimed
  // it within six hours, close both records and clear the active dedupe key so
  // an admin or the next scheduler tick can start a fresh run.
  const expiredQueued = await db
    .select({ id: jobs.id, runId: jobs.runId, availableAt: jobs.availableAt })
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "queued"),
        lt(jobs.availableAt, new Date(now.getTime() - QUEUED_JOB_MAX_WAIT_MS)),
      ),
    );
  let expired = 0;
  for (const job of expiredQueued) {
    await db.transaction(async (tx) => {
      const [result] = await tx
        .update(jobs)
        .set({
          status: "failed",
          dedupeKey: null,
          lockedAt: null,
          lockedBy: null,
          lastError: "No worker claimed this job within six hours.",
        })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "queued"), eq(jobs.availableAt, job.availableAt)));
      if (!affectedRows(result)) return;
      expired += 1;
      await tx
        .update(runs)
        .set({
          status: "failed",
          phase: "done",
          finishedAt: now,
          errorLog: { reason: "No worker claimed this run within six hours." },
        })
        .where(and(eq(runs.id, job.runId), eq(runs.status, "running")));
    });
  }

  const stale = await db
    .select({
      job: jobs,
      runStatus: runs.status,
    })
    .from(jobs)
    .innerJoin(runs, eq(runs.id, jobs.runId))
    .where(
      and(
        eq(jobs.status, "running"),
        or(
          inArray(runs.status, ["completed", "failed", "stopped"]),
          isNull(jobs.lockedAt),
          lt(jobs.lockedAt, new Date(now.getTime() - STALE_JOB_LEASE_MS)),
          and(inArray(runs.phase, ["awaiting_callback", "ingesting"]), lte(runs.deadlineAt, now)),
        ),
      ),
    );

  let requeued = 0;
  let failed = 0;
  let orphaned = 0;
  for (const row of stale) {
    const job = row.job;
    // Recovery can overlap across workers. Match the exact lease read above,
    // not merely a running job that might already have a different owner.
    const observedLease = and(
      eq(jobs.id, job.id),
      eq(jobs.status, "running"),
      eq(jobs.attempts, job.attempts),
      job.lockedBy == null ? isNull(jobs.lockedBy) : eq(jobs.lockedBy, job.lockedBy),
      job.lockedAt == null ? isNull(jobs.lockedAt) : eq(jobs.lockedAt, job.lockedAt),
    );
    const outcome = await db.transaction(async (tx) => {
      const [owned] = await tx.select({ id: jobs.id }).from(jobs).where(observedLease).limit(1).for("update");
      if (!owned) return null;
      // Re-read under lock: a callback may have claimed or completed ingestion
      // since the candidate scan, even if the worker lease did not change.
      const [run] = await tx.select({ status: runs.status, phase: runs.phase, deadlineAt: runs.deadlineAt })
        .from(runs).where(eq(runs.id, job.runId)).limit(1).for("update");
      if (!run) return null;
      const terminal = terminalJobStatus(run.status);
      if (terminal) {
        await tx.update(jobs).set({
          status: terminal, dedupeKey: null, lockedAt: null, lockedBy: null,
          lastError: terminal === "succeeded" ? null : "Run ended while its worker lease was active.",
        }).where(observedLease);
        return "orphaned";
      }

      const deliveryActive = run.phase === "awaiting_callback" || run.phase === "ingesting";
      if (deliveryActive && run.deadlineAt && run.deadlineAt.getTime() > now.getTime()) return null;
      const executionStarted = run.phase !== "queued";
      if (executionStarted || job.attempts >= job.maxAttempts) {
        const reason = deliveryActive
          ? "Result delivery did not finish before its deadline. Start a new run to retry."
          : executionStarted
            ? "The extraction worker expired after starting. Start a new run to retry safely."
            : "Worker lease expired too many times.";
        await tx.update(jobs).set({
          status: "failed", dedupeKey: null, lockedAt: null, lockedBy: null, lastError: reason,
        }).where(observedLease);
        await tx.update(runs).set({
          status: "failed", phase: "done", finishedAt: now, errorLog: { reason },
        }).where(and(eq(runs.id, job.runId), eq(runs.status, "running")));
        return "failed";
      }
      await tx.update(jobs).set({ status: "queued", lockedAt: null, lockedBy: null, availableAt: now })
        .where(observedLease);
      await tx.update(runs).set({
        phase: "queued", deadlineAt: new Date(now.getTime() + QUEUED_RUN_DEADLINE_MS),
      }).where(and(eq(runs.id, job.runId), eq(runs.status, "running")));
      return "requeued";
    });
    if (outcome === "orphaned") orphaned += 1;
    if (outcome === "failed") failed += 1;
    if (outcome === "requeued") requeued += 1;
  }
  return { requeued, failed, orphaned, expired };
}

/** Drain a small bounded batch; horizontal workers may call this concurrently. */
export async function drainJobs(limit = 2) {
  const batchSize = drainBatchSize(limit);
  const candidates = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, "queued"), lte(jobs.availableAt, new Date())))
    .orderBy(asc(jobs.availableAt), asc(jobs.id))
    .limit(batchSize);

  const workerId = randomUUID();
  const outcomes = await Promise.all(candidates.map((job) => processJob(job.id, workerId)));
  return {
    considered: candidates.length,
    succeeded: outcomes.filter(Boolean).length,
    failedOrSkipped: outcomes.filter((ok) => !ok).length,
  };
}

export async function queuedJobCount() {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(jobs)
    .where(inArray(jobs.status, ["queued", "running"]));
  return Number(row?.count ?? 0);
}
