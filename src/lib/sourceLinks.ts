import { isPublicHttpUrl } from "./publicUrl";

/**
 * Ordered working-link candidates for an event URL that no longer exists.
 * The source's configured listing wins because it is more useful than a
 * generic homepage; path ancestors and the origin are last-resort fallbacks.
 */
export function sourceLinkFallbackCandidates(
  url: string,
  configuredFallbacks: Array<string | null | undefined>,
): string[] {
  const candidates: string[] = [];
  const add = (candidate: string | null | undefined) => {
    if (!candidate || !isPublicHttpUrl(candidate) || candidates.includes(candidate)) return;
    candidates.push(candidate);
  };

  configuredFallbacks.forEach(add);

  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    for (let depth = segments.length - 1; depth > 0; depth--) {
      add(`${parsed.origin}/${segments.slice(0, depth).join("/")}/`);
    }
    add(`${parsed.origin}/`);
  } catch {
    // The configured fallbacks above are still usable for a malformed URL.
  }

  return candidates.filter((candidate) => candidate !== url);
}
