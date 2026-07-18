import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { destinations } from "@/db/schema";

export type InventoryItem = { title: string; startTimes: number[]; location: string | null };

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

  const cfg = (typeof dest.config === "string" ? JSON.parse(dest.config) : dest.config) as {
    inventory_url?: string;
  };
  if (!cfg?.inventory_url) return [];

  try {
    const res = await fetch(cfg.inventory_url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) return [];
    const body = (await res.json()) as Record<string, unknown>;
    const posts = Array.isArray(body.posts) ? (body.posts as Record<string, unknown>[]) : [];
    return posts.map((p) => {
      const sessions = Array.isArray(p.sessions) ? (p.sessions as Record<string, unknown>[]) : [];
      const loc = p.location as Record<string, unknown> | null | undefined;
      return {
        // CommunityHub calls the title "name".
        title: String(p.name ?? p.title ?? ""),
        startTimes: sessions.map((s) => Number(s.start)).filter((n) => Number.isFinite(n) && n > 0),
        location: (loc?.address ?? loc?.name ?? null) as string | null,
      };
    });
  } catch {
    // The run continues without this check rather than failing outright.
    return [];
  }
}
