import "server-only";

import { randomUUID } from "crypto";
import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { jobs, runs } from "@/db/schema";
import { runExtraction } from "./agent";

const STALE_LOCK_MS = 15 * 60_000;

type EnqueuedRun = { jobId: number; runId: number; deduplicated: boolean };

function isDuplicateKey(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ER_DUP_ENTRY",
  );
}

function affectedRows(result: unknown) {
  return Number((result as { affectedRows?: number })?.affectedRows ?? 0);
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
        deadlineAt: new Date(Date.now() + 60 * 60_000),
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
export async function processJob(jobId: number, workerId = randomUUID()): Promise<boolean> {
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

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return false;

  await db
    .update(runs)
    .set({ phase: "fetching", deadlineAt: new Date(Date.now() + 60 * 60_000) })
    .where(eq(runs.id, job.runId));

  try {
    await runExtraction(job.runId);
    const [run] = await db
      .select({ status: runs.status, errorLog: runs.errorLog })
      .from(runs)
      .where(eq(runs.id, job.runId))
      .limit(1);

    if (run?.status === "completed") {
      await db
        .update(jobs)
        .set({ status: "succeeded", dedupeKey: null, lockedAt: null, lockedBy: null })
        .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId)));
      return true;
    }

    const message = JSON.stringify(run?.errorLog ?? { message: "Run did not complete." }).slice(0, 4000);
    await db
      .update(jobs)
      .set({
        status: "failed",
        dedupeKey: null,
        lockedAt: null,
        lockedBy: null,
        lastError: message,
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId)));
    return false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker failed";
    await db.transaction(async (tx) => {
      await tx
        .update(jobs)
        .set({
          status: "failed",
          dedupeKey: null,
          lockedAt: null,
          lockedBy: null,
          lastError: message.slice(0, 4000),
        })
        .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId)));
      await tx
        .update(runs)
        .set({
          status: "failed",
          phase: "done",
          finishedAt: new Date(),
          errorLog: { reason: message },
        })
        .where(eq(runs.id, job.runId));
    });
    return false;
  }
}

/**
 * Make jobs abandoned by a terminated serverless invocation runnable again.
 * The same run id is reused, keeping its timeline and publish idempotency keys.
 */
export async function requeueStaleJobs(now = new Date()) {
  const stale = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(now.getTime() - STALE_LOCK_MS))));

  let requeued = 0;
  let failed = 0;
  for (const job of stale) {
    if (job.attempts >= job.maxAttempts) {
      await db.transaction(async (tx) => {
        await tx
          .update(jobs)
          .set({
            status: "failed",
            dedupeKey: null,
            lockedAt: null,
            lockedBy: null,
            lastError: "Worker lease expired too many times.",
          })
          .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")));
        await tx
          .update(runs)
          .set({
            status: "failed",
            phase: "done",
            finishedAt: now,
            errorLog: { reason: "Worker lease expired too many times." },
          })
          .where(eq(runs.id, job.runId));
      });
      failed += 1;
    } else {
      const [result] = await db
        .update(jobs)
        .set({ status: "queued", lockedAt: null, lockedBy: null, availableAt: now })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "running")));
      requeued += affectedRows(result);
    }
  }
  return { requeued, failed };
}

/** Drain a small bounded batch; horizontal workers may call this concurrently. */
export async function drainJobs(limit = 2) {
  const batchSize = Math.min(Math.max(Math.floor(limit), 1), 5);
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
