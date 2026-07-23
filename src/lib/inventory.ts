import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { destinations } from "@/db/schema";
import { fetchPublicBytes } from "./fetchPage";

export type InventoryItem = {
  title: string;
  startTimes: number[];
  location: string | null;
  description: string | null;
  // The post's own page on CommunityHub, so a duplicate can link to what it duplicates.
  url: string | null;
};

/**
 * What the community's endpoint already holds, approved and pending alike.
 *
 * Without this an event already live on CommunityHub is re-collected as new,
 * because our own database has never seen it.
 */
export async function fetchDestinationInventory(communityId: number): Promise<InventoryItem[]> {
  const [dest] = await db
    .select()
    .from(destinations)
    .where(and(eq(destinations.communityId, communityId), eq(destinations.active, true)))
    .limit(1);
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

  try {
    const res = await fetchPublicBytes(cfg.inventory_url, {
      maxBytes: 5 * 1024 * 1024,
      timeoutMs: 25_000,
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
      return {
        // CommunityHub calls the title "name".
        title: String(p.name ?? p.title ?? ""),
        startTimes: sessions.map((s) => Number(s.start)).filter((n) => Number.isFinite(n) && n > 0),
        location: (loc?.address ?? loc?.name ?? null) as string | null,
        description: (typeof p.description === "string" && p.description) || (typeof p.excerpt === "string" && p.excerpt) || null,
        url: url ?? null,
      };
    });
  } catch {
    // The run continues without this check rather than failing outright.
    return [];
  }
}
