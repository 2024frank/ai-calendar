import { isPublicHttpUrl } from "./publicUrl";

export type TrustedAgentDuplicate = {
  eventId: number | null;
  url: string | null;
};

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
