import "server-only";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { runEvents } from "@/db/schema";

/** Append one step to a run's observable trail. */
export async function emit(
  runId: number,
  kind: string,
  label: string,
  data?: Record<string, unknown>,
) {
  const [[row]] = (await db.execute(
    sql`select coalesce(max(seq),0)+1 as next from run_events where run_id = ${runId}`,
  )) as unknown as [{ next: number }[]];
  const seq = Number(row?.next ?? 1);
  await db.insert(runEvents).values({
    runId,
    seq,
    kind,
    label: label.slice(0, 255),
    data: data ?? null,
  });
  return seq;
}

export async function listRunEvents(runId: number, afterId = 0) {
  return db
    .select()
    .from(runEvents)
    .where(afterId > 0 ? and(eq(runEvents.runId, runId), gt(runEvents.id, afterId)) : eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.id));
}
