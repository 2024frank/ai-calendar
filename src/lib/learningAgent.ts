import "server-only";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { learnings, runs, sources } from "@/db/schema";
import { llmComplete } from "./llm";
import { modelChain } from "./models";
import { emit } from "./runEvents";

/**
 * The agent that learns from the reviewers.
 *
 * Everything else in this system reads websites. This one reads people: the
 * moment a reviewer fixes a field or turns an event down is the only judgement
 * here that came from a human looking at a real event, and it was being spent
 * on that one event and then forgotten.
 *
 * Each correction becomes one instruction, which every extraction agent is
 * given on its next run, and which is kept in full so the whole set can be
 * exported as training data for a local model later.
 */

const LESSON_SCHEMA = {
  type: "object",
  properties: {
    // Empty when the correction taught nothing worth repeating.
    lesson: { type: "string" },
    scope: { type: "string", enum: ["source", "community", "global"] },
    worthKeeping: { type: "boolean" },
  },
  required: ["lesson", "scope", "worthKeeping"],
  additionalProperties: false,
} as const;

export type LessonInput = {
  eventId: number | null;
  sourceId: number | null;
  communityId: number | null;
  reviewerId: number | null;
  triggerKind: "rejection" | "edit";
  /** For an edit. */
  fieldName?: string | null;
  beforeValue?: string | null;
  afterValue?: string | null;
  /** For a rejection: the code and the reviewer's note. */
  reason?: string | null;
  /** Title of the event, for context. */
  title?: string | null;
  /** The source's name, so a lesson can name the site it is about. */
  sourceName?: string | null;
};

const clip = (v: string | null | undefined, n = 300) =>
  v ? v.replace(/\s+/g, " ").trim().slice(0, n) : "";

/**
 * Open a run so this agent's tokens and dollars are billed like every other.
 * Every agent counts toward the cost; none is free because it is small.
 */
async function openRun(sourceId: number | null, communityId: number | null): Promise<number | null> {
  if (!sourceId || !communityId) return null;
  const [res] = await db.insert(runs).values({
    sourceId,
    communityId,
    runKind: "learning",
    status: "running",
    phase: "fetching",
  });
  return (res as { insertId: number }).insertId;
}

/**
 * Turn one human correction into one instruction.
 *
 * Deliberately small: a single correction in, a single sentence out, no page
 * fetching and no tools. It is the cheapest agent here and runs on every edit,
 * so it has to stay that way.
 */
export async function learnFromCorrection(input: LessonInput): Promise<number | null> {
  const runId = await openRun(input.sourceId, input.communityId);

  const context =
    input.triggerKind === "edit"
      ? `A reviewer corrected one field before publishing.

EVENT: ${clip(input.title, 120)}
SOURCE: ${clip(input.sourceName, 80)}
FIELD: ${input.fieldName}
WHAT THE AGENT PRODUCED: ${clip(input.beforeValue) || "(empty)"}
WHAT THE REVIEWER CHANGED IT TO: ${clip(input.afterValue) || "(empty)"}`
      : `A reviewer rejected an event outright.

EVENT: ${clip(input.title, 120)}
SOURCE: ${clip(input.sourceName, 80)}
REASON: ${clip(input.reason, 400)}`;

  const prompt = `${context}

Write ONE instruction that would have stopped this from happening, addressed to the agent that extracts events. Then say how widely it applies.

Rules for the instruction:
- One sentence, plain, imperative. It goes into a prompt, not a report.
- Describe the behaviour to change, never this one event's values. "Use the organizer's own email, not the venue's" teaches something; "set contact to jane@x.org" does not.
- scope "source" when it is about how this one website is laid out, "community" when it is about this community's conventions, "global" when it is true of any event anywhere.
- If the correction was a one-off, a typo, or taught nothing repeatable, set worthKeeping false and leave the lesson empty. Most single edits are not lessons; be strict.`;

  let parsed: { lesson?: string; scope?: string; worthKeeping?: boolean } = {};
  let model: string | null = null;
  try {
    const res = await llmComplete({
      prompt,
      schema: LESSON_SCHEMA as unknown as Record<string, unknown>,
      schemaName: "lesson",
      maxTokens: 400,
      models: await modelChain(),
      runId: runId ?? undefined,
    });
    model = res.model;
    parsed = JSON.parse(res.text || "{}");
  } catch {
    parsed = {};
  }

  const closeRun = async () => {
    if (runId) {
      await db
        .update(runs)
        .set({ status: "completed", phase: "done", finishedAt: new Date() })
        .where(eq(runs.id, runId));
    }
  };

  const lesson = (parsed.lesson ?? "").trim();

  // Say what was decided either way. A lesson declined is a judgement worth
  // seeing; silently writing nothing looks identical to the agent failing.
  if (!parsed.worthKeeping || lesson.length < 12) {
    if (runId) {
      await emit(runId, "model_turn", `Nothing worth teaching from this ${input.triggerKind}`, {
        field: input.fieldName ?? null,
        worthKeeping: Boolean(parsed.worthKeeping),
      });
    }
    await closeRun();
    return null;
  }

  const scope =
    parsed.scope === "community" || parsed.scope === "global" ? parsed.scope : "source";

  const [ins] = await db.insert(learnings).values({
    communityId: input.communityId,
    sourceId: input.sourceId,
    eventId: input.eventId,
    triggerKind: input.triggerKind,
    fieldName: input.fieldName ?? null,
    beforeValue: input.beforeValue ?? null,
    afterValue: input.afterValue ?? null,
    reason: input.reason ?? null,
    lesson: lesson.slice(0, 2000),
    scope,
    reviewerId: input.reviewerId,
    model,
  });
  const learningId = (ins as { insertId: number }).insertId;
  if (runId) {
    await emit(runId, "model_turn", `Learned: ${lesson.slice(0, 140)}`, {
      learningId,
      scope,
      field: input.fieldName ?? null,
    });
  }
  await closeRun();
  return learningId;
}

/**
 * The lessons an extraction run for this source should be given: the ones about
 * this site, the ones about its community, and the ones true everywhere. That
 * last group is how one reviewer's correction reaches every other agent.
 */
export async function lessonsFor(sourceId: number): Promise<string> {
  const [src] = await db
    .select({ communityId: sources.communityId })
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);
  if (!src) return "";

  const rows = await db
    .select({ id: learnings.id, lesson: learnings.lesson, scope: learnings.scope })
    .from(learnings)
    .where(
      and(
        eq(learnings.status, "active"),
        or(
          eq(learnings.scope, "global"),
          and(eq(learnings.scope, "community"), eq(learnings.communityId, src.communityId)),
          and(eq(learnings.scope, "source"), eq(learnings.sourceId, sourceId)),
        ),
      ),
    )
    .orderBy(desc(learnings.id))
    .limit(40);

  if (!rows.length) return "";

  // Count what was actually handed over, so a lesson nobody ever sees is
  // distinguishable from one that has been in front of forty runs.
  await db
    .update(learnings)
    .set({ timesServed: sql`${learnings.timesServed} + 1` })
    .where(inArray(learnings.id, rows.map((r) => r.id)));

  const bySource = rows.filter((r) => r.scope === "source");
  const wider = rows.filter((r) => r.scope !== "source");
  const out: string[] = [
    "WHAT REVIEWERS HAVE TAUGHT US. These come from people correcting earlier runs. Follow them unless the page in front of you plainly says otherwise; the source always wins over a remembered rule.",
  ];
  if (bySource.length) {
    out.push("\nAbout this source:");
    for (const r of bySource) out.push(`- ${r.lesson}`);
  }
  if (wider.length) {
    out.push("\nLearned from other sources, and expected to hold here too:");
    for (const r of wider) out.push(`- ${r.lesson}`);
  }
  return out.join("\n");
}

/** Every lesson with the correction behind it, for training a local model. */
export async function exportLearnings(communityId?: number | null) {
  const q = db.select().from(learnings);
  const rows = communityId
    ? await q.where(eq(learnings.communityId, communityId)).orderBy(desc(learnings.id))
    : await q.orderBy(desc(learnings.id));
  return rows;
}
