import { GET as getEvents } from "@/app/api/public/events/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Stable, versioned public contract. Keep the legacy route during migration.
export function GET(req: Request) {
  return getEvents(req);
}
