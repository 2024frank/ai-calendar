import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, users } from "@/db/schema";

export type ActivityAction =
  | "login"
  | "approve"
  | "reject"
  | "edit"
  | "user_invited"
  | "user_updated"
  | "user_deleted"
  | "source_added"
  | "endpoint_set"
  | "model_switched";

type LogInput = {
  action: ActivityAction;
  actorUserId?: number | null;
  actorEmail?: string | null;
  targetType?: string | null;
  targetId?: number | null;
  summary?: string;
  detail?: Record<string, unknown>;
};

/**
 * Record one auditable action. Best-effort: a logging failure must never break
 * the action a person actually took, so everything is wrapped and swallowed.
 */
export async function logActivity(input: LogInput): Promise<void> {
  try {
    await db.insert(activityLog).values({
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      summary: input.summary?.slice(0, 300) ?? null,
      detail: input.detail ?? null,
    });
  } catch {
    /* auditing is best-effort */
  }
}

export type ActivityRow = {
  id: number;
  action: string;
  actorEmail: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: number | null;
  summary: string | null;
  createdAt: Date;
};

/** Recent activity, newest first, optionally filtered by actor or action. */
export async function recentActivity(opts: {
  actorUserId?: number;
  action?: string;
  limit?: number;
}): Promise<ActivityRow[]> {
  const conds = [];
  if (opts.actorUserId) conds.push(eq(activityLog.actorUserId, opts.actorUserId));
  if (opts.action) conds.push(eq(activityLog.action, opts.action));
  return db
    .select({
      id: activityLog.id,
      action: activityLog.action,
      actorEmail: activityLog.actorEmail,
      actorName: users.name,
      targetType: activityLog.targetType,
      targetId: activityLog.targetId,
      summary: activityLog.summary,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.actorUserId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(activityLog.id))
    .limit(opts.limit ?? 200);
}

/** The distinct people who appear in the log, for the filter dropdown. */
export async function activityActors() {
  return db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(activityLog)
    .innerJoin(users, eq(users.id, activityLog.actorUserId))
    .groupBy(users.id, users.email, users.name);
}
