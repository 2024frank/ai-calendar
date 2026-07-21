import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { communities, events, runs, sources } from "@/db/schema";
import { HARD_ISSUES } from "./ingest";
import { mergePosterImages } from "./mergePosters";
import { validateEvent, type ExtractedEvent } from "./contract";
import { fillTemplate, type PromptVars } from "./promptTemplate";
import { llmComplete } from "./llm";
import { modelChain } from "./models";
import { emit } from "./runEvents";
import { fetchPage, hasImageExtension, isGenericImage } from "./fetchPage";

/** Fields the correction agent may supply, all optional. */
const CORRECTION_SCHEMA = {
  type: "object",
  properties: {
    imageCdnUrl: { type: ["string", "null"] },
    imageB64: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    extendedDescription: { type: ["string", "null"] },
    contactEmail: { type: ["string", "null"] },
    phone: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    website: { type: ["string", "null"] },
    found: { type: "boolean" },
  },
  required: ["found"],
  additionalProperties: false,
} as const;

// Events are corrected in parallel. One at a time meant 40 events x ~30s each,
// which blows past the platform's request limit and the run dies with nothing
// done. The deadline stops us starting new work in time to finish cleanly;
// whatever is left is picked up by the next pass.
const CONCURRENCY = 6;
const TIME_BUDGET_MS = 225_000;

export type CorrectionResult = {
  checked: number;
  corrected: number;
  stillMissing: number;
  remaining: number;
};

type SourceRow = typeof sources.$inferSelect;
type EventRow = typeof events.$inferSelect;

/** Try to complete one auto-rejected event. Returns true when it was re-queued. */
async function correctOne(
  runId: number,
  ev: EventRow,
  source: SourceRow,
  instructions: string,
  models: string[],
): Promise<boolean> {
  const missing = String(ev.rejectionReason ?? "").replace(/^[^:]*:\s*/, "");
  const pageUrl = ev.calendarSourceUrl || ev.website || source.url || "";

  const prompt = `An event we extracted was set aside because it is INCOMPLETE. Find the missing information on the source and return it. Do not invent anything.

EVENT: ${ev.title}
WHAT IS MISSING: ${missing}
ITS OWN PAGE: ${pageUrl}
WHAT WE ALREADY HAVE: ${JSON.stringify({
    description: ev.description,
    location: ev.location,
    contactEmail: ev.contactEmail,
    phone: ev.phone,
    website: ev.website,
  })}

HOW TO READ THIS SOURCE (the same instructions the extractor uses):
${instructions || "(no special instructions; use the page directly)"}

Fetch that one page and return ONLY the missing fields, filled from the real page. For a missing image, give the event's own photo URL in imageCdnUrl, or its base64 in imageB64 if the host blocks direct download. If a field genuinely is not on the page, leave it null and set found=false. Never use a logo or a shared site image as an event photo. Be quick: this is a single-page lookup, not a crawl.`;

  let patch: Record<string, unknown> = {};
  try {
    const res = await llmComplete({
      prompt,
      schema: CORRECTION_SCHEMA as unknown as Record<string, unknown>,
      schemaName: "correction",
      sandbox: true,
      fetchUrls: 3,
      maxSteps: 6,
      maxTokens: 3000,
      models,
      runId,
    });
    patch = JSON.parse(res.text || "{}");
  } catch {
    patch = {};
  }

  // Resolve the image: agent URL, agent base64, or a server-side page rescue.
  let imageCdnUrl = ev.imageCdnUrl;
  let imageData = ev.imageData;
  const agentImg = typeof patch.imageCdnUrl === "string" ? patch.imageCdnUrl : null;
  const agentB64 = typeof patch.imageB64 === "string" ? patch.imageB64 : null;
  if (!imageCdnUrl && !imageData && agentB64 && agentB64.length > 100) {
    imageData = agentB64.replace(/\s+/g, "");
    imageCdnUrl = null;
  } else if (!imageCdnUrl && !imageData && agentImg && !isGenericImage(agentImg)) {
    if (hasImageExtension(agentImg)) imageCdnUrl = agentImg;
    else {
      const buf = await mergePosterImages([agentImg]).catch(() => null);
      if (buf) imageData = buf.toString("base64");
      else imageCdnUrl = agentImg;
    }
  }
  if (!imageCdnUrl && !imageData && pageUrl) {
    try {
      const page = await fetchPage(pageUrl, 10_000);
      if (page.image && !isGenericImage(page.image)) imageCdnUrl = page.image;
    } catch {
      /* leave missing */
    }
  }

  const candidate = {
    ...ev,
    description: (patch.description as string) || ev.description,
    extendedDescription: (patch.extendedDescription as string) ?? ev.extendedDescription,
    contactEmail: (patch.contactEmail as string) || ev.contactEmail,
    phone: (patch.phone as string) || ev.phone,
    location: (patch.location as string) || ev.location,
    website: (patch.website as string) || ev.website,
    imageCdnUrl,
    imageData,
    sessions: ev.sessions ?? [],
    sponsors: ev.sponsors ?? [],
    postTypeId: ev.postTypeIds ?? [],
    title: ev.title ?? "",
    eventType: ev.eventType ?? "ot",
  } as unknown as ExtractedEvent;

  const issues = validateEvent(candidate);
  const remaining = issues.filter((i) => HARD_ISSUES.has(i));
  if (remaining.length) {
    await emit(runId, "dedup_outcome", `Still incomplete (${remaining.join(", ")}): ${ev.title}`, {
      eventId: ev.id,
    });
    return false;
  }

  // A corrected event re-enters review exactly like a freshly extracted one:
  // it leaves auto-rejected immediately and carries the same soft "needs
  // fields" flag if anything non-blocking is still missing.
  const softIssues = issues.filter((i) => !HARD_ISSUES.has(i));
  await db
    .update(events)
    .set({
      status: "pending",
      rejectionReason: softIssues.length ? `Missing before publish: ${softIssues.join(", ")}` : null,
      imageCdnUrl: imageCdnUrl ?? null,
      imageData: imageData ?? null,
      description: candidate.description,
      extendedDescription: candidate.extendedDescription ?? null,
      contactEmail: candidate.contactEmail ?? null,
      phone: candidate.phone ?? null,
      location: candidate.location ?? null,
      website: candidate.website ?? null,
      correctedAt: new Date(),
    })
    .where(eq(events.id, ev.id));
  await emit(runId, "queue_outcome", `Corrected and re-queued: ${ev.title}`, { eventId: ev.id });
  return true;
}

/**
 * Correction agent. Re-reads each auto-rejected event's own page using its
 * source's instructions, fills the missing field, and re-queues it for review
 * tagged as corrected. Pass sourceId to limit it to one source, or null to work
 * across every source at once.
 */
export async function runCorrection(
  runId: number,
  sourceId: number | null,
  limit = 60,
): Promise<CorrectionResult> {
  const startedAt = Date.now();

  const rejects = await db
    .select()
    .from(events)
    .where(
      sourceId
        ? and(eq(events.sourceId, sourceId), eq(events.status, "auto_rejected"))
        : and(eq(events.status, "auto_rejected"), isNotNull(events.sourceId)),
    )
    .limit(limit);

  if (!rejects.length) {
    await emit(runId, "run_finished", "Nothing auto-rejected to correct", { checked: 0 });
    await db
      .update(runs)
      .set({ status: "completed", phase: "done", finishedAt: new Date() })
      .where(eq(runs.id, runId));
    return { checked: 0, corrected: 0, stillMissing: 0, remaining: 0 };
  }

  // Load each involved source once, with its instructions filled in.
  const sourceIds = [...new Set(rejects.map((e) => e.sourceId!).filter(Boolean))];
  const srcRows = await db.select().from(sources).where(inArray(sources.id, sourceIds));
  const commRows = await db.select().from(communities);
  const ctx = new Map<number, { source: SourceRow; instructions: string }>();
  for (const src of srcRows) {
    const community = commRows.find((c) => c.id === src.communityId);
    const vars: PromptVars = {
      source_name: src.name,
      urls: [src.url ?? ""],
      today: new Date().toLocaleDateString("en-CA", {
        timeZone: community?.timezone ?? "America/New_York",
      }),
      timezone: community?.timezone ?? "America/New_York",
      org_name: src.orgName,
      org_website: src.orgWebsite,
      contact_email: src.orgContactEmail,
      phone: src.orgPhone,
      lookahead_days: String(src.lookaheadDays ?? 14),
    };
    ctx.set(src.id, { source: src, instructions: fillTemplate(src.specialInstructions ?? "", vars) });
  }

  await emit(runId, "run_started", `Correcting ${rejects.length} auto-rejected event(s)`, {
    count: rejects.length,
    sources: sourceIds.length,
  });

  const models = await modelChain();
  let corrected = 0;
  let stillMissing = 0;
  let processed = 0;

  for (let i = 0; i < rejects.length; i += CONCURRENCY) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break; // finish cleanly; rest next pass
    const batch = rejects.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async (ev) => {
        const c = ctx.get(ev.sourceId!);
        if (!c) return false;
        try {
          return await correctOne(runId, ev, c.source, c.instructions, models);
        } catch {
          return false;
        }
      }),
    );
    processed += batch.length;
    for (const ok of outcomes) ok ? corrected++ : stillMissing++;
  }

  const remaining = rejects.length - processed;
  await emit(
    runId,
    "run_finished",
    `Corrected ${corrected}, still incomplete ${stillMissing}${remaining ? `, ${remaining} left for the next pass` : ""}`,
    { checked: processed, corrected, stillMissing, remaining },
  );
  await db
    .update(runs)
    .set({
      status: "completed",
      phase: "done",
      finishedAt: new Date(),
      eventsFound: processed,
      eventsExtracted: corrected,
    })
    .where(eq(runs.id, runId));

  return { checked: processed, corrected, stillMissing, remaining };
}
