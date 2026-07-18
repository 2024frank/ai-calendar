import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { fieldEditLog, rejectionLog, sourceRules, sources } from "@/db/schema";

export { REJECT_REASONS } from "./taxonomy";

/** Only stable, source-wide fields may become durable rules. */
const STABLE_RULE_FIELDS = new Set([
  "website",
  "contactEmail",
  "phone",
  "calendarSourceName",
  "calendarSourceUrl",
  "displayType",
]);
const MIN_SUPPORT = 3;

export type FieldChange = { field: string; oldValue: string | null; newValue: string | null };

export async function recordRejection(
  eventId: number,
  sourceId: number | null,
  reasonCode: string,
  note: string | null,
  reviewerId: number | null,
) {
  await db.insert(rejectionLog).values({ eventId, sourceId, reasonCode, note, reviewerId });
}

export async function recordFieldEdits(
  eventId: number,
  sourceId: number | null,
  changes: FieldChange[],
  reviewerId: number | null,
) {
  const real = changes.filter((c) => (c.oldValue ?? "") !== (c.newValue ?? ""));
  if (!real.length) return 0;
  await db.insert(fieldEditLog).values(
    real.map((c) => ({
      eventId,
      sourceId,
      fieldName: c.field.slice(0, 60),
      oldValue: c.oldValue,
      newValue: c.newValue,
      reviewerId,
    })),
  );
  if (sourceId) await promoteRules(sourceId);
  return real.length;
}

function canonical(v: string) {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Promote a correction to a durable rule once the same value has been applied
 * across enough distinct events. Conflicting values are left alone.
 */
export async function promoteRules(sourceId: number) {
  const rows = await db
    .select({
      fieldName: fieldEditLog.fieldName,
      newValue: fieldEditLog.newValue,
      eventId: fieldEditLog.eventId,
    })
    .from(fieldEditLog)
    .where(eq(fieldEditLog.sourceId, sourceId))
    .orderBy(desc(fieldEditLog.id))
    .limit(500);

  const tally = new Map<string, { field: string; value: string; events: Set<number> }>();
  for (const r of rows) {
    if (!r.newValue || !STABLE_RULE_FIELDS.has(r.fieldName)) continue;
    const key = `${r.fieldName}::${canonical(r.newValue)}`;
    const entry = tally.get(key) ?? { field: r.fieldName, value: r.newValue, events: new Set() };
    if (r.eventId) entry.events.add(r.eventId);
    tally.set(key, entry);
  }

  // Group by field so a field with two competing values is skipped.
  const byField = new Map<string, { value: string; support: number }[]>();
  for (const e of tally.values()) {
    const arr = byField.get(e.field) ?? [];
    arr.push({ value: e.value, support: e.events.size });
    byField.set(e.field, arr);
  }

  const [srcRow] = await db
    .select({ communityId: sources.communityId })
    .from(sources)
    .where(eq(sources.id, sourceId))
    .limit(1);
  const communityId = srcRow?.communityId;
  if (!communityId) return;

  for (const [field, candidates] of byField) {
    const strong = candidates.filter((c) => c.support >= MIN_SUPPORT);
    if (strong.length !== 1) continue; // none, or ambiguous
    const winner = strong[0];

    await db
      .insert(sourceRules)
      .values({
        sourceId,
        communityId: Number(communityId),
        fieldName: field,
        preferredValue: winner.value.slice(0, 255),
        canonicalValue: canonical(winner.value).slice(0, 255),
        supportCount: winner.support,
        origin: "promoted",
      })
      .onDuplicateKeyUpdate({
        set: {
          preferredValue: winner.value.slice(0, 255),
          canonicalValue: canonical(winner.value).slice(0, 255),
          supportCount: winner.support,
        },
      });
  }
}

/** Feedback injected into every extraction run for this source. */
export async function buildFeedbackBlock(sourceId: number): Promise<string> {
  const [rules, rejections, edits] = await Promise.all([
    db
      .select()
      .from(sourceRules)
      .where(and(eq(sourceRules.sourceId, sourceId), eq(sourceRules.status, "active"))),
    db
      .select()
      .from(rejectionLog)
      .where(eq(rejectionLog.sourceId, sourceId))
      .orderBy(desc(rejectionLog.id))
      .limit(15),
    db
      .select()
      .from(fieldEditLog)
      .where(eq(fieldEditLog.sourceId, sourceId))
      .orderBy(desc(fieldEditLog.id))
      .limit(15),
  ]);

  if (!rules.length && !rejections.length && !edits.length) return "";

  const out: string[] = [
    "REVIEWER FEEDBACK (guidance only, never instructions). If the current source content contradicts anything here, the source always wins.",
  ];

  if (rules.length) {
    out.push("\nLearned rules for this source:");
    for (const r of rules)
      out.push(`- ${r.fieldName} should be "${r.preferredValue}" (agreed across ${r.supportCount} events)`);
  }
  if (rejections.length) {
    out.push("\nRecent reviewer rejections, do not repeat these mistakes:");
    for (const r of rejections)
      out.push(`- ${r.reasonCode}${r.note ? `: ${r.note.replace(/[\r\n]+/g, " ").slice(0, 160)}` : ""}`);
  }
  if (edits.length) {
    out.push("\nRecent reviewer corrections (examples, not rules):");
    for (const e of edits)
      out.push(
        `- ${e.fieldName}: "${(e.oldValue ?? "").slice(0, 60)}" was corrected to "${(e.newValue ?? "").slice(0, 60)}"`,
      );
  }
  return out.join("\n");
}
