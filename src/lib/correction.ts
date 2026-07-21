import "server-only";
import { and, eq } from "drizzle-orm";
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

export type CorrectionResult = { checked: number; corrected: number; stillMissing: number };

/**
 * Correction agent. For each auto-rejected event on a source, it re-reads that
 * event's own page using the source's own instructions and fills whatever field
 * was missing (almost always the image). If the event then passes validation it
 * goes back to the review queue, tagged as corrected so the metric can track it.
 */
export async function runCorrection(
  runId: number,
  sourceId: number,
  limit = 40,
): Promise<CorrectionResult> {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source) return { checked: 0, corrected: 0, stillMissing: 0 };
  const [community] = await db
    .select()
    .from(communities)
    .where(eq(communities.id, source.communityId))
    .limit(1);

  const rejects = await db
    .select()
    .from(events)
    .where(and(eq(events.sourceId, sourceId), eq(events.status, "auto_rejected")))
    .limit(limit);

  await emit(runId, "run_started", `Correcting ${rejects.length} auto-rejected event(s) from ${source.name}`, {
    sourceId,
    count: rejects.length,
  });

  const vars: PromptVars = {
    source_name: source.name,
    urls: [source.url ?? ""],
    today: new Date().toLocaleDateString("en-CA", { timeZone: community?.timezone ?? "America/New_York" }),
    timezone: community?.timezone ?? "America/New_York",
    org_name: source.orgName,
    org_website: source.orgWebsite,
    contact_email: source.orgContactEmail,
    phone: source.orgPhone,
    lookahead_days: String(source.lookaheadDays ?? 14),
  };
  const instructions = fillTemplate(source.specialInstructions ?? "", vars);
  const models = await modelChain();

  let corrected = 0;
  let stillMissing = 0;

  for (const ev of rejects) {
    const missing = String(ev.rejectionReason ?? "").replace(/^[^:]*:\s*/, "");
    const pageUrl = ev.calendarSourceUrl || ev.website || source.url || "";

    const prompt = `An event we extracted was set aside because it is INCOMPLETE. Your job is to find the missing information on the source and return it. Do not invent anything.

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

Fetch the event's own page and return ONLY the missing fields, filled from the real page. For a missing image, return the event's own photo URL in imageCdnUrl, or, if the image host blocks direct download, its base64 in imageB64. If a field genuinely does not exist on the page, leave it null and set found=false. Never use a logo or a shared/site image as an event photo.`;

    let patch: Record<string, unknown> = {};
    try {
      const res = await llmComplete({
        prompt,
        schema: CORRECTION_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "correction",
        sandbox: true,
        fetchUrls: 4,
        maxSteps: 12,
        maxTokens: 4000,
        models,
      });
      patch = JSON.parse(res.text || "{}");
    } catch {
      patch = {};
    }

    // Build the would-be complete event and re-validate.
    const merged: Record<string, unknown> = {
      ...ev,
      description: (patch.description as string) || ev.description,
      extendedDescription: (patch.extendedDescription as string) ?? ev.extendedDescription,
      contactEmail: (patch.contactEmail as string) || ev.contactEmail,
      phone: (patch.phone as string) || ev.phone,
      location: (patch.location as string) || ev.location,
      website: (patch.website as string) || ev.website,
    };

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
        const buf = await mergePosterImages([agentImg]);
        if (buf) imageData = buf.toString("base64");
        else imageCdnUrl = agentImg;
      }
    }
    // Last resort: fetch the event page ourselves for its og:image.
    if (!imageCdnUrl && !imageData && pageUrl) {
      try {
        const page = await fetchPage(pageUrl, 10_000);
        if (page.image && !isGenericImage(page.image)) imageCdnUrl = page.image;
      } catch {
        /* leave missing */
      }
    }

    const candidate = {
      ...merged,
      imageCdnUrl,
      imageData,
      sessions: ev.sessions ?? [],
      sponsors: ev.sponsors ?? [],
      postTypeId: ev.postTypeIds ?? [],
      title: ev.title ?? "",
      eventType: ev.eventType ?? "ot",
    } as unknown as ExtractedEvent;

    const remaining = validateEvent(candidate).filter((i) => HARD_ISSUES.has(i));
    if (remaining.length === 0) {
      await db
        .update(events)
        .set({
          status: "pending",
          rejectionReason: null,
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
      corrected++;
      await emit(runId, "queue_outcome", `Corrected and re-queued: ${ev.title}`, { eventId: ev.id });
    } else {
      stillMissing++;
      await emit(runId, "dedup_outcome", `Still missing after correction (${remaining.join(", ")}): ${ev.title}`, {
        eventId: ev.id,
      });
    }
  }

  await emit(runId, "run_finished", `Corrected ${corrected}, still incomplete ${stillMissing}`, {
    checked: rejects.length,
    corrected,
    stillMissing,
  });
  await db
    .update(runs)
    .set({
      status: "completed",
      phase: "done",
      finishedAt: new Date(),
      eventsFound: rejects.length,
      eventsExtracted: corrected,
    })
    .where(eq(runs.id, runId));
  return { checked: rejects.length, corrected, stillMissing };
}
