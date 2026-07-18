import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listCommunities, listSources } from "@/lib/data";
import { DiscoveryStatus, Badge } from "@/components/bits";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const s = await requireUser();
  const [rows, comms] = await Promise.all([listSources(s), listCommunities()]);
  const communityName = new Map(comms.map((c) => [c.id, c.name]));

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="spread">
        <div>
          <div className="page-title">Sources</div>
          <div className="muted">Where events are extracted from.</div>
        </div>
        <Link className="btn primary" href="/sources/new">
          + Add source
        </Link>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Source</th>
              <th>Community</th>
              <th>Type</th>
              <th>Mode</th>
              <th>Discovery</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: 20 }}>
                  No sources yet. Add one with just a name and a link.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link
                    href={`/sources/${r.id}`}
                    style={{ color: "var(--accent)", fontWeight: 600 }}
                  >
                    {r.name}
                  </Link>
                  {r.url && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {r.url.replace(/^https?:\/\//, "").slice(0, 48)}
                    </div>
                  )}
                </td>
                <td>{communityName.get(r.communityId) ?? r.communityId}</td>
                <td>{r.sourceType}</td>
                <td>{r.mode ?? <span className="muted">inherit</span>}</td>
                <td style={{ maxWidth: 320 }}>
                  <DiscoveryStatus status={r.discoveryStatus} />
                  {r.discoveryStatus === "failed" && r.discoveryError && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.3 }}>
                      {r.discoveryError}
                    </div>
                  )}
                </td>
                <td>
                  {r.active ? (
                    <Badge kind="good">on</Badge>
                  ) : (
                    <Badge kind="neutral">off</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
