import Link from "next/link";
import { isAdmin, requireUser } from "@/lib/auth";
import { dashboardStats, listCommunities } from "@/lib/data";
import { reapStaleRuns } from "@/lib/retention";
import { fmtDate, RunStatus } from "@/components/bits";
import { ButtonLink, Card, EmptyState, Icon, type IconName, PageHeader, TableShell } from "@/components/ui";

export const dynamic = "force-dynamic";

const numberFormatter = new Intl.NumberFormat("en-US");

function Kpi({ label, value, href, icon, hint }: { label: string; value: number; href?: string; icon: IconName; hint: string }) {
  const contents = (
    <>
      <div className="kpi-card__top"><span>{label}</span><Icon name={icon} /></div>
      <div className="kpi">{numberFormatter.format(value)}</div>
      <div className="kpi-card__hint">{hint}</div>
    </>
  );
  return href ? <Link className="surface kpi-card" href={href}>{contents}</Link> : <Card className="kpi-card">{contents}</Card>;
}

export default async function DashboardPage() {
  const session = await requireUser();
  const admin = isAdmin(session);
  await reapStaleRuns().catch(() => undefined);
  const stats = await dashboardStats(session);
  const communities = session.role === "platform_admin" ? await listCommunities() : [];

  return (
    <div className="grid" style={{ gap: 24 }}>
      <PageHeader
        eyebrow="Workspace Overview"
        title="Dashboard"
        description={admin ? "Monitor ingestion, review quality, and publishing across your workspace." : "Focus on the events that need your review."}
        actions={admin ? <ButtonLink href="/sources/new" variant="primary" icon="plus">Add Source</ButtonLink> : <ButtonLink href="/review" variant="primary" icon="review">Open Review Queue</ButtonLink>}
      />

      <section className="kpi-grid" aria-label="Workspace metrics">
        {admin && <Kpi label="Active Sources" value={stats.activeSources} href="/sources" icon="sources" hint="Currently ingesting" />}
        <Kpi label="Pending Review" value={stats.pending} href="/review" icon="review" hint="Needs a decision" />
        <Kpi label="Duplicates" value={stats.duplicate} href="/review?tab=duplicates" icon="inbox" hint="Protected from republishing" />
        <Kpi label="Approved" value={stats.approved} href="/review?tab=approved" icon="check" hint="Reviewer approved" />
        <Kpi label="Published" value={stats.submitted} href="/review?tab=submitted" icon="arrow-right" hint="Sent downstream" />
      </section>

      {communities.length > 0 && (
        <Card className="surface--flush">
          <div className="section-header" style={{ padding: "18px 20px 4px" }}>
            <div><h2>Communities</h2><p>Publishing defaults across the platform.</p></div>
            <ButtonLink href="/communities" size="sm">Manage Communities</ButtonLink>
          </div>
          <TableShell label="Communities summary">
            <table className="tbl">
              <thead><tr><th>Community</th><th>Mode</th><th>Timezone</th><th>Destination</th></tr></thead>
              <tbody>
                {communities.map((community) => (
                  <tr key={community.id}>
                    <td><strong>{community.name}</strong></td>
                    <td>{community.defaultMode}</td>
                    <td className="muted">{community.timezone}</td>
                    <td>{community.defaultDestinationId ? "CommunityHub" : "AI Calendar Only"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </Card>
      )}

      {admin && (
        <Card className="surface--flush">
          <div className="section-header" style={{ padding: "18px 20px 4px" }}>
            <div><h2>Recent Runs</h2><p>Latest extraction and discovery activity.</p></div>
          </div>
          {stats.recentRuns.length === 0 ? (
            <EmptyState icon="sources" title="No Runs Yet" description="Run a source to start extracting events and see its timeline here." action={<ButtonLink href="/sources" icon="arrow-right">View Sources</ButtonLink>} />
          ) : (
            <TableShell label="Recent agent runs">
              <table className="tbl">
                <thead><tr><th>Run</th><th>Kind</th><th>Status</th><th>Found</th><th>Published</th><th>Started</th><th><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {stats.recentRuns.map((run) => (
                    <tr key={run.id}>
                      <td><Link href={`/runs/${run.id}`} className="table-link">#{run.id}</Link></td>
                      <td>{run.runKind}</td>
                      <td><RunStatus status={run.status} /></td>
                      <td className="numeric">{numberFormatter.format(run.eventsFound)}</td>
                      <td className="numeric">{numberFormatter.format(run.eventsPublished)}</td>
                      <td className="muted">{fmtDate(run.startedAt)}</td>
                      <td><ButtonLink href={`/runs/${run.id}`} size="sm" icon="arrow-right">Open</ButtonLink></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          )}
        </Card>
      )}
    </div>
  );
}
