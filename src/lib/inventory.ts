import "server-only";
import { fetchPublicBytes } from "./fetchPage";
import { resolveDestination } from "./destination";

export type InventoryItem = {
  eventType: string | null;
  title: string;
  startTimes: number[];
  sessions: { startTime: number; endTime: number }[];
  location: string | null;
  description: string | null;
  sourceUrls: string[];
  // The post's own page on CommunityHub, so a duplicate can link to what it duplicates.
  url: string | null;
  /** Sponsor names as CommunityHub shows them, so a post can be traced to its organization. */
  sponsors: string[];
  /** Our review link, present only on posts the importer sent. */
  ingestedPostUrl: string | null;
};

export type InventoryResult = {
  items: InventoryItem[];
  available: boolean;
  reason?: string;
};

const unavailable = (reason: string): InventoryResult => ({ items: [], available: false, reason });

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
): Promise<InventoryResult> {
  const { destination: dest, error } = await resolveDestination(communityId, sourceId);
  if (error) return unavailable("The publishing destination could not be resolved.");
  if (!dest) return { items: [], available: true };
  if (timeoutMs < 250) return unavailable("The run had no time left to check the destination inventory.");

  let cfg: { inventory_url?: string; api_base?: string };
  try {
    cfg = (typeof dest.config === "string" ? JSON.parse(dest.config) : dest.config) as {
      inventory_url?: string;
      api_base?: string;
    };
  } catch {
    return unavailable("The destination configuration is invalid.");
  }
  if (!cfg?.inventory_url) return unavailable("No duplicate-check inventory is configured for this destination.");

  // Two things about the CommunityHub listing decide whether this check works.
  //
  //   * allPosts must be literally "true". The hub reads a bare "&allPosts"
  //     as off, and without it every post still awaiting a hub moderator is
  //     missing, which is every post we submit until they act on it. That is
  //     how four Allen Memorial exhibitions were sent twice in August.
  //   * filter=future is the right feed, and it must stay. It keeps every post
  //     with a session that has not ended yet, long-running exhibitions
  //     included (measured 8 Sep 2026: the future feed held all 50 posts with
  //     an upcoming session, 25 of them already open, and answered in 1.7 s).
  //     filter=all returns the whole archive instead, 1,400 posts and 3 MB,
  //     and the hub takes about 47 s to build it. That is past the 25 s budget
  //     below, so asking for it made this fetch time out on every run from
  //     12 Aug to 8 Sep and left the destination check silently empty.
  const inventoryUrl = (() => {
    try {
      const u = new URL(cfg.inventory_url!);
      u.searchParams.set("filter", "future");
      u.searchParams.set("allPosts", "true");
      return u.toString();
    } catch {
      return cfg.inventory_url!;
    }
  })();

  try {
    const res = await fetchPublicBytes(inventoryUrl, {
      // The upcoming feed is about 100 KB today; leave room for it to grow.
      maxBytes: 24 * 1024 * 1024,
      timeoutMs: Math.max(1, Math.min(timeoutMs, 25_000)),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return unavailable("The destination inventory request failed.");
    const body = JSON.parse(new TextDecoder().decode(res.bytes)) as Record<string, unknown>;
    if (!Array.isArray(body?.posts)) return unavailable("The destination returned an unexpected inventory response.");
    const posts = body.posts as Record<string, unknown>[];
    return { available: true, items: posts.map((p) => {
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
      const sponsors = Array.isArray(p.sponsors)
        ? (p.sponsors as Record<string, unknown>[])
          .map((sponsor) => (typeof sponsor?.name === "string" ? sponsor.name.trim() : ""))
          .filter(Boolean)
        : [];
      return {
        eventType: typeof p.eventType === "string" ? p.eventType : null,
        // CommunityHub calls the title "name".
        title: String(p.name ?? p.title ?? ""),
        startTimes: sessions.map((s) => Number(s.start)).filter((n) => Number.isFinite(n) && n > 0),
        // End times are required to prove a rolling announcement is already
        // covered. Missing bounds are not fabricated into duplicate evidence.
        sessions: sessions.map((s) => ({ startTime: Number(s.start), endTime: Number(s.end) }))
          .filter((s) => Number.isFinite(s.startTime) && s.startTime > 0 &&
            Number.isFinite(s.endTime) && s.endTime >= s.startTime),
        location: (loc?.address ?? loc?.name ?? null) as string | null,
        description: (typeof p.description === "string" && p.description) || (typeof p.excerpt === "string" && p.excerpt) || null,
        sourceUrls,
        url: url ?? null,
        sponsors,
        ingestedPostUrl: typeof p.ingestedPostUrl === "string" && p.ingestedPostUrl.trim() ? p.ingestedPostUrl.trim() : null,
      };
    }) };
  } catch {
    return unavailable("The destination inventory is unavailable; check for existing posts before approval.");
  }
}
