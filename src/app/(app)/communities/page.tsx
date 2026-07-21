import { requirePlatformAdmin } from "@/lib/auth";
import { listCommunities, listDestinations } from "@/lib/data";
import { Badge } from "@/components/bits";
import { CommunitySettings } from "./CommunitySettings";
import { EndpointEditor } from "./EndpointEditor";

export const dynamic = "force-dynamic";

export default async function CommunitiesPage() {
  await requirePlatformAdmin();
  const comms = await listCommunities();
  const dests = await listDestinations();
  const byCommunity = new Map<number, typeof dests>();
  for (const d of dests) {
    const arr = byCommunity.get(d.communityId) ?? [];
    arr.push(d);
    byCommunity.set(d.communityId, arr);
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div>
        <div className="page-title">Communities</div>
        <div className="muted">Tenants on the platform and where their events publish.</div>
      </div>

      {comms.map((c) => {
        const ds = byCommunity.get(c.id) ?? [];
        return (
          <div key={c.id} className="card">
            <div className="spread">
              <div>
                <h3>{c.name}</h3>
                <div className="muted" style={{ fontSize: 12 }}>
                  slug: {c.slug}
                </div>
              </div>
              {c.defaultDestinationId ? (
                <Badge kind="good">publishes to endpoint</Badge>
              ) : (
                <Badge kind="neutral">AI calendar only</Badge>
              )}
            </div>

            <CommunitySettings
              communityId={c.id}
              defaultMode={c.defaultMode}
              timezone={c.timezone}
            />

            <EndpointEditor
              communityId={c.id}
              currentName={ds[0]?.name ?? ""}
              currentApiBase={
                (() => {
                  const cfg = ds[0]?.config;
                  const o = (typeof cfg === "string" ? JSON.parse(cfg) : cfg) as { api_base?: string } | null;
                  return o?.api_base ?? "";
                })()
              }
              currentActive={Boolean(ds[0]?.active && c.defaultDestinationId)}
            />
          </div>
        );
      })}
    </div>
  );
}
