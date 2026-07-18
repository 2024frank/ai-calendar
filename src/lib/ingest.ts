import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { communities, events, sources } from "@/db/schema";
import {
  computeDedupKey,
  contentMatches,
  maxStartTime,
  normalizeEvent,
  validateEvent,
  type ExtractedEvent,
} from "./contract";
import { emit } from "./runEvents";

export type IngestCounts = {
  found: number;
  inserted: number;
  duplicate: number;
  invalid: number;
};

type SourceRow = typeof sources.$inferSelect;
type CommunityRow = typeof communities.$inferSelect;

export function effectiveMode(source: SourceRow, community: CommunityRow) {
  return source.mode ?? community.defaultMode;
}

/**
 * Persist extracted candidates. Nothing is ever silently dropped:
 * invalid or ambiguous events still land in the review queue.
 */
export async function ingestEvents(
  runId: number,
  source: SourceRow,
  community: CommunityRow,
  rawEvents: Record<string, unknown>[],
): Promise<IngestCounts> {
  const counts: IngestCounts = { found: rawEvents.length, inserted: 0, duplicate: 0, invalid: 0 };
  const mode = effectiveMode(source, community);

  // Existing events in this community used for content-based duplicate checking.
  const existing = await db
    .select({
      id: events.id,
      title: events.title,
      location: events.location,
      sessions: events.sessions,
      dedupKey: events.dedupKey,
    })
    .from(events)
    .where(
      and(
        eq(events.communityId, source.communityId),
        inArray(events.status, ["pending", "approved", "submitted"]),
      ),
    )
    .orderBy(desc(events.id))
    .limit(400);

  const existingByKey = new Map(existing.filter((e) => e.dedupKey).map((e) => [e.dedupKey!, e.id]));

  for (const raw of rawEvents) {
    const e: ExtractedEvent = normalizeEvent(raw);
    const issues = validateEvent(e);
    const dedupKey = computeDedupKey(e);
    const startTimes = e.sessions.map((s) => s.startTime);

    await emit(
      runId,
      "candidate_validated",
      `${e.title || "(untitled)"} — ${issues.length ? `${issues.length} issue(s)` : "valid"}`,
      { title: e.title, valid: issues.length === 0, issues },
    );

    // 1) exact same-source signature
    let duplicateOf: number | null = existingByKey.get(dedupKey) ?? null;
    let dupReason = duplicateOf ? "identical title and date signature" : "";

    // 2) content match: date + location first, then title
    if (!duplicateOf) {
      for (const x of existing) {
        const xs = Array.isArray(x.sessions)
          ? (x.sessions as { startTime?: number }[]).map((s) => Number(s.startTime)).filter(Boolean)
          : [];
        const m = contentMatches(
          { title: e.title, startTimes, location: e.location ?? null },
          { title: x.title ?? "", startTimes: xs, location: x.location ?? null },
        );
        if (m.match) {
          duplicateOf = x.id;
          dupReason = m.reason;
          break;
        }
      }
    }

    if (duplicateOf) {
      await emit(runId, "dedup_outcome", `Duplicate of #${duplicateOf} (${dupReason})`, {
        title: e.title,
        duplicateOfEventId: duplicateOf,
        reason: dupReason,
      });
    } else {
      await emit(runId, "dedup_outcome", `Unique: ${e.title}`, { title: e.title, unique: true });
    }

    // Restricted mode keeps every clean event in review. Duplicates are preserved, not dropped.
    const status = duplicateOf ? "duplicate" : "pending";
    if (issues.length) counts.invalid++;
    if (duplicateOf) counts.duplicate++;

    const [res] = await db.insert(events).values({
      communityId: source.communityId,
      sourceId: source.id,
      status,
      eventType: e.eventType,
      title: e.title,
      description: e.description,
      extendedDescription: e.extendedDescription,
      sessions: e.sessions,
      startTimeMax: maxStartTime(e),
      locationType: e.locationType,
      location: e.location,
      urlLink: e.urlLink,
      displayType: e.display,
      postTypeIds: e.postTypeId,
      sponsors: e.sponsors,
      website: e.website,
      registrationUrl: e.registrationUrl,
      imageCdnUrl: e.imageCdnUrl,
      contactEmail: e.contactEmail,
      phone: e.phone,
      dedupKey,
      provenance: source.sourceKind === "aggregator" ? "aggregator" : "original_org",
      duplicateOfEventId: duplicateOf,
      rejectionReason: issues.length ? `Required fields are missing: ${issues.join(", ")}` : null,
      calendarSourceName: source.calendarSourceName ?? source.name,
      calendarSourceUrl: source.calendarSourceUrl ?? source.url,
    });
    const newId = (res as { insertId: number }).insertId;
    if (!duplicateOf) counts.inserted++;
    if (!duplicateOf) existingByKey.set(dedupKey, newId);

    await emit(
      runId,
      "queue_outcome",
      duplicateOf
        ? `Kept as duplicate (#${newId})`
        : issues.length
          ? `Sent to review with issues (#${newId})`
          : `Sent to review (#${newId})`,
      { eventId: newId, status, mode, issues },
    );
  }

  return counts;
}
