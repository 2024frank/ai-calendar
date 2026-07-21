import Link from "next/link";
import { isAdmin, requireUser } from "@/lib/auth";
import { dashboardStats, listCommunities } from "@/lib/data";
import { reapStaleRuns } from "@/lib/retention";
import { fmtDate, RunStatus } from "@/components/bits";

export const dynamic = "force-dynamic";

function Kpi({ label, value, href }: { label: string; value: number; href?: string }) {
  const inner = (
    <div className="card">
      <div className="kpi-label">{label}</div>
      <div className="kpi">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function DashboardPage() {
  const s = await requireUser();
  const admin = isAdmin(s);
  // Self-heal: a run killed by the platform never marks itself failed, so do
  // it here where the stale "running" badge would otherwise sit forever.
  await reapStaleRuns().catch(() => undefined);
  const stats = await dashboardStats(s);
  const comms = s.role === "platform_admin" ? await listCommunities() : [];

  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="spread">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="muted">
            {admin
              ? "Ingestion, review, and publishing at a glance."
              : "Your review queue at a glance."}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: `repeat(${admin ? 4 : 3}, 1fr)` }}>
        {admin && <Kpi label="Active sources" value={stats.activeSources} href="/sources" />}
        <Kpi label="Pending review" value={stats.pending} href="/review" />
        <Kpi label="Approved" value={stats.approved} href="/review?tab=approved" />
        <Kpi label="Published" value={stats.submitted} href="/review?tab=submitted" />
      </div>

      {comms.length > 0 && (
        <div className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <h3>Communities</h3>
            <Link className="btn" href="/communities">
              Manage
            </Link>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Community</th>
                <th>Mode</th>
                <th>Timezone</th>
                <th>Endpoint</th>
              </tr>
            </thead>
            <tbody>
              {comms.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>{c.defaultMode}</td>
                  <td className="muted">{c.timezone}</td>
                  <td>{c.defaultDestinationId ? "CommunityHub" : "AI calendar only"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {admin && (
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Recent runs</h3>
        {stats.recentRuns.length === 0 ? (
          <div className="muted">No runs yet. Trigger a source to start extracting.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Run</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Found</th>
                <th>Published</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentRuns.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/runs/${r.id}`} style={{ color: "var(--accent)", fontWeight: 600 }}>
                      #{r.id}
                    </Link>
                  </td>
                  <td>{r.runKind}</td>
                  <td>
                    <RunStatus status={r.status} />
                  </td>
                  <td>{r.eventsFound}</td>
                  <td>{r.eventsPublished}</td>
                  <td className="muted">{fmtDate(r.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}
    </div>
  );
}
