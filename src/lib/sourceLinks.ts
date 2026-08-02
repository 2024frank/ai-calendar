import { isPublicHttpUrl } from "./publicUrl";

/**
 * Ordered working-link candidates for an event URL that no longer exists.
 * The nearest path ancestor wins because it is the page immediately before the
 * broken detail URL. A configured listing handles flat URL schemes where the
 * only path ancestor would be an unhelpful homepage.
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

  let origin: string | null = null;
  try {
    const parsed = new URL(url);
    origin = `${parsed.origin}/`;
    const segments = parsed.pathname.split("/").filter(Boolean);
    for (let depth = segments.length - 1; depth > 0; depth--) {
      add(`${parsed.origin}/${segments.slice(0, depth).join("/")}/`);
    }
  } catch {
    // The configured fallbacks below are still usable for a malformed URL.
  }

  configuredFallbacks.forEach(add);
  add(origin);

  return candidates.filter((candidate) => candidate !== url);
}
