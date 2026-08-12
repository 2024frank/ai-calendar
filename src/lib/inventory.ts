import "server-only";
import { fetchPublicBytes } from "./fetchPage";
import { resolveDestination } from "./destination";

export type InventoryItem = {
  title: string;
  startTimes: number[];
  location: string | null;
  description: string | null;
  sourceUrls: string[];
  // The post's own page on CommunityHub, so a duplicate can link to what it duplicates.
  url: string | null;
};

/**
 * What the community's endpoint already holds, approved and pending alike.
 *
 * Without this an event already live on CommunityHub is re-collected as new,
 * because our own database has never seen it.
 */
export async function fetchDestinationInventory(
  communityId: number,
  sourceId?: number | null,
  timeoutMs = 25_000,
): Promise<InventoryItem[]> {
  const { destination: dest } = await resolveDestination(communityId, sourceId);
  if (!dest) return [];

  let cfg: { inventory_url?: string; api_base?: string };
  try {
    cfg = (typeof dest.config === "string" ? JSON.parse(dest.config) : dest.config) as {
      inventory_url?: string;
      api_base?: string;
    };
  } catch {
    return [];
  }
  if (!cfg?.inventory_url) return [];

  // CommunityHub hides two whole classes of post from the default listing, and
  // both are exactly the ones we must not resend:
  //   * filter=future drops long-running items. An exhibition opening 22 Aug
  //     and closing next July is simply absent from the "future" feed.
  //   * without allPosts, anything still awaiting a hub moderator is absent
  //     too, and every post we submit sits unapproved until they act on it.
  // So the feed we deduped against showed 21 posts while the hub held 1,344,
  // and four Allen Memorial exhibitions were published twice. Ask for
  // everything and do the date filtering ourselves.
  const inventoryUrl = (() => {
    try {
      const u = new URL(cfg.inventory_url!);
      u.searchParams.set("filter", "all");
      if (!u.searchParams.has("allPosts")) u.searchParams.set("allPosts", "true");
      return u.toString();
    } catch {
      return cfg.inventory_url!;
    }
  })();

  try {
    const res = await fetchPublicBytes(inventoryUrl, {
      // The full listing is far larger than the filtered one it replaced.
      maxBytes: 24 * 1024 * 1024,
      timeoutMs: Math.max(1, Math.min(timeoutMs, 25_000)),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return [];
    const body = JSON.parse(new TextDecoder().decode(res.bytes)) as Record<string, unknown>;
    const posts = Array.isArray(body.posts) ? (body.posts as Record<string, unknown>[]) : [];
    return posts.map((p) => {
      const sessions = Array.isArray(p.sessions) ? (p.sessions as Record<string, unknown>[]) : [];
      const loc = p.location as Record<string, unknown> | null | undefined;
      // The public post page is /calendar/post/<numeric id> on the hub site.
      // The posts carry no url field, so build it from the id (never the token).
      const builtUrl =
        cfg.api_base && p.id != null && /^\d+$/.test(String(p.id))
          ? `${cfg.api_base}/calendar/post/${p.id}`
          : undefined;
      const url =
        [p.url, p.permalink, p.link, p.post_url]
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .find((v) => /^https?:\/\//i.test(v)) ?? builtUrl;
      const buttons = Array.isArray(p.buttons) ? (p.buttons as Record<string, unknown>[]) : [];
      const sourceUrls = [
        p.website,
        p.calendarSourceUrl,
        p.urlLink,
        ...buttons.map((button) => button.link),
      ].filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      return {
        // CommunityHub calls the title "name".
        title: String(p.name ?? p.title ?? ""),
        startTimes: sessions.map((s) => Number(s.start)).filter((n) => Number.isFinite(n) && n > 0),
        location: (loc?.address ?? loc?.name ?? null) as string | null,
        description: (typeof p.description === "string" && p.description) || (typeof p.excerpt === "string" && p.excerpt) || null,
        sourceUrls,
        url: url ?? null,
      };
    });
  } catch {
    // The run continues without this check rather than failing outright.
    return [];
  }
}
