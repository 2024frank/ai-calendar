import { z } from "zod";

export const MAX_EVALUATION_BYTES = 1_000_000;
export const MAX_EVALUATION_ROWS = 500;
const text = (max: number) => z.string().trim().min(1).max(max);
const instant = z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString());
const rowSchema = z.object({
  id: text(100), title: text(500), startTime: instant,
  endTime: instant.nullable().optional().default(null),
  location: text(2000).nullable().optional().default(null),
  url: text(2048).nullable().optional().default(null),
}).strict().refine((r) => r.endTime === null || r.endTime >= r.startTime, "End precedes start");
const provenanceSchema = z.object({ description: text(4000), capturedAt: instant }).strict();
const schema = z.object({
  version: z.literal(1), sourceId: z.number().int().positive(), title: text(200),
  period: z.object({ start: instant, end: instant }).strict(),
  scope: z.object({ description: text(4000), referenceCompleteness: z.enum(["complete", "partial", "unknown"]), confirmed: z.literal(true) }).strict(),
  provenance: z.object({
    reference: provenanceSchema.extend({ independent: z.literal(true) }), extracted: provenanceSchema,
  }).strict(),
  reference: z.array(rowSchema).max(MAX_EVALUATION_ROWS),
  extracted: z.array(rowSchema).max(MAX_EVALUATION_ROWS),
  matches: z.array(z.object({ referenceId: text(100), extractedId: text(100) }).strict()).max(MAX_EVALUATION_ROWS),
  humanConfirmedMatches: z.literal(true),
}).strict();

export type EvaluationInput = z.infer<typeof schema>;
export type EvaluationRow = z.infer<typeof rowSchema>;
const fields = ["title", "startTime", "endTime", "location", "url"] as const;

/** Only validates retained data. No URLs are fetched, matches inferred, or events changed. */
export function validateEvaluation(raw: unknown): EvaluationInput {
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > MAX_EVALUATION_BYTES) throw new Error("Evaluation input is too large");
  const input = schema.parse(raw);
  if (input.period.end <= input.period.start) throw new Error("Period end must follow start");
  for (const rows of [input.reference, input.extracted]) {
    if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error("Duplicate snapshot IDs");
    if (rows.some((r) => r.startTime < input.period.start || r.startTime >= input.period.end)) throw new Error("Snapshot start date outside declared period");
  }
  const referenceIds = new Set(input.reference.map((r) => r.id));
  const extractedIds = new Set(input.extracted.map((r) => r.id));
  const matchedReference = new Set<string>();
  const matchedExtracted = new Set<string>();
  for (const match of input.matches) {
    if (!referenceIds.has(match.referenceId) || !extractedIds.has(match.extractedId)) throw new Error("Unknown matched ID");
    if (matchedReference.has(match.referenceId) || matchedExtracted.has(match.extractedId)) throw new Error("Matches must be one-to-one");
    matchedReference.add(match.referenceId); matchedExtracted.add(match.extractedId);
  }
  return input;
}

/** Deterministic comparisons of human assertions, not automatic accuracy scoring. */
export function compareEvaluation(input: EvaluationInput) {
  const reference = new Map(input.reference.map((r) => [r.id, r]));
  const extracted = new Map(input.extracted.map((r) => [r.id, r]));
  const matches = input.matches.map((match) => {
    const a = reference.get(match.referenceId)!; const b = extracted.get(match.extractedId)!;
    return { ...match, differences: fields.filter((field) => a[field] !== b[field]).map((field) => ({ field, reference: a[field], extracted: b[field] })) };
  });
  const matchedReference = new Set(input.matches.map((r) => r.referenceId));
  const matchedExtracted = new Set(input.matches.map((r) => r.extractedId));
  return {
    version: 1 as const, referenceCount: input.reference.length, extractedCount: input.extracted.length,
    confirmedMatchCount: matches.length,
    referenceCompleteness: input.scope.referenceCompleteness,
    referenceCoveragePct: input.reference.length ? Math.round(matches.length / input.reference.length * 10000) / 100 : null,
    matches,
    referenceOnly: input.reference.filter((r) => !matchedReference.has(r.id)),
    extractedOnly: input.extracted.filter((r) => !matchedExtracted.has(r.id)),
    caveat: "Coverage is of this declared reference only, not measured overall accuracy. Unmatched extracted candidates are not proven false positives. Human matches and reference completeness have not been independently verified by this software.",
  };
}
export type EvaluationReport = ReturnType<typeof compareEvaluation>;
