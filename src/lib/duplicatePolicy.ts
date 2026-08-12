import { isPublicHttpUrl } from "./publicUrl";

export type TrustedAgentDuplicate = {
  eventId: number | null;
  url: string | null;
};

type SourceUrlRecord = {
  website?: unknown;
  calendarSourceUrl?: unknown;
  urlLink?: unknown;
  registrationUrl?: unknown;
  sourceUrls?: unknown;
};

const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_(cid|eid)$/i,
];

const GENERIC_SOURCE_PATHS = new Set([
  "calendar",
  "calendar-of-events",
  "classes",
  "event",
  "events",
  "exhibition",
  "exhibitions",
  "exhibitions-events",
  "programs",
  "upcoming",
  "upcoming-events",
]);

/** Canonical CommunityHub post links are public URLs ending in a numeric id. */
export function canonicalCommunityHubPostUrl(value: unknown): string | null {
  if (typeof value !== "string" || !isPublicHttpUrl(value)) return null;
  try {
    const url = new URL(value);
    if (url.search || url.hash || !/\/calendar\/post\/\d+\/?$/.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Canonical source-event pages are useful duplicate evidence, but broad source
 * home/listing pages are not. Keep meaningful query params because some ticket
 * providers identify the event there; drop only tracking noise.
 */
export function canonicalSourceEventUrl(value: unknown): string | null {
  if (typeof value !== "string" || !isPublicHttpUrl(value)) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.some((re) => re.test(key))) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";

    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) return null;
    const last = parts[parts.length - 1]?.toLowerCase() ?? "";
    if (GENERIC_SOURCE_PATHS.has(last)) return null;
    if (parts.length === 1 && !url.searchParams.size && last.length < 18) return null;

    return url.toString();
  } catch {
    return null;
  }
}

export function sourceEventUrlSet(record: SourceUrlRecord): Set<string> {
  const raw = [
    record.website,
    record.calendarSourceUrl,
    record.urlLink,
    record.registrationUrl,
    ...(Array.isArray(record.sourceUrls) ? record.sourceUrls : []),
  ];
  return new Set(
    raw
      .map(canonicalSourceEventUrl)
      .filter((url): url is string => Boolean(url)),
  );
}

export function sourceEventUrlsOverlap(a: SourceUrlRecord, b: SourceUrlRecord): boolean {
  const left = sourceEventUrlSet(a);
  if (!left.size) return false;
  for (const url of sourceEventUrlSet(b)) {
    if (left.has(url)) return true;
  }
  return false;
}

/**
 * A model-reported duplicate is authoritative only when it points at a record
 * the server independently loaded from this tenant's own inventories.
 */
export function trustedAgentDuplicate(
  raw: Record<string, unknown>,
  knownEventIds: ReadonlySet<number>,
  knownRemoteUrls: ReadonlySet<string>,
): TrustedAgentDuplicate {
  const rawId = Number(raw._agentDuplicateOfId);
  const eventId =
    Number.isInteger(rawId) && rawId > 0 && knownEventIds.has(rawId) ? rawId : null;
  const candidateUrl = canonicalCommunityHubPostUrl(raw._agentDuplicateOf);
  const url = candidateUrl && knownRemoteUrls.has(candidateUrl) ? candidateUrl : null;
  return { eventId, url };
}
