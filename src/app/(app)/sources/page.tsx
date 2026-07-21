import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin, requireUser } from "@/lib/auth";
import { listCommunities, listSources } from "@/lib/data";
import { Badge, DiscoveryStatus } from "@/components/bits";
import { ButtonLink, Card, EmptyState, PageHeader, TableShell } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const session = await requireUser();
  if (!isAdmin(session)) redirect("/review");
  const [sources, communities] = await Promise.all([listSources(session), listCommunities()]);
  const communityName = new Map(communities.map((community) => [community.id, community.name]));

  return (
    <div className="grid" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Ingestion"
        title="Sources"
        description="Manage the websites and inboxes your agents monitor for new events."
        actions={<ButtonLink href="/sources/new" variant="primary" icon="plus">Add Source</ButtonLink>}
      />

      <Card className="surface--flush">
        <div className="section-header" style={{ padding: "18px 20px 4px" }}>
          <div><h2>Connected Sources</h2><p>{sources.length} {sources.length === 1 ? "source" : "sources"} in this workspace</p></div>
        </div>
        {sources.length === 0 ? (
          <EmptyState icon="sources" title="Connect Your First Source" description="Add a website or inbox and the Discovery Agent will determine the best extraction strategy." action={<ButtonLink href="/sources/new" variant="primary" icon="plus">Add Source</ButtonLink>} />
        ) : (
          <TableShell label="Connected sources">
            <table className="tbl">
              <thead><tr><th>Source</th><th>Community</th><th>Type</th><th>Mode</th><th>Discovery</th><th>Active</th><th><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id}>
                    <td style={{ maxWidth: 330 }}>
                      <Link href={`/sources/${source.id}`} className="table-link">{source.name}</Link>
                      {source.url && <div className="muted truncate" style={{ fontSize: 11, marginTop: 3 }}>{source.url.replace(/^https?:\/\//, "")}</div>}
                    </td>
                    <td>{communityName.get(source.communityId) ?? `Community ${source.communityId}`}</td>
                    <td style={{ textTransform: "capitalize" }}>{source.sourceType}</td>
                    <td style={{ textTransform: "capitalize" }}>{source.mode ?? <span className="muted">Inherited</span>}</td>
                    <td style={{ maxWidth: 320 }}>
                      <DiscoveryStatus status={source.discoveryStatus} />
                      {source.discoveryStatus === "failed" && source.discoveryError && <div className="muted" style={{ fontSize: 11, marginTop: 5, lineHeight: 1.35 }}>{source.discoveryError}</div>}
                    </td>
                    <td>{source.active ? <Badge kind="good">On</Badge> : <Badge kind="neutral">Off</Badge>}</td>
                    <td><ButtonLink href={`/sources/${source.id}`} size="sm" icon="arrow-right">Manage</ButtonLink></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
