import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, runs } from "@/db/schema";
import { isAdmin, requireUser } from "@/lib/auth";
import { getSource } from "@/lib/data";
import { cronToLabel, cronToValue } from "@/lib/schedule";
import { DiscoveryStatus, RunStatus, fmtDate, Badge } from "@/components/bits";
import { RunActions } from "./RunActions";
import { SourceSettings } from "./SourceSettings";
import { EditSource } from "./EditSource";
import { SourcePrompt } from "./SourcePrompt";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div>{value || <span className="muted">—</span>}</div>
    </div>
  );
}

export default async function SourceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireUser();
  if (!isAdmin(s)) redirect("/review");
  const source = await getSource(s, Number(id));
  if (!source) notFound();

  const [recentRuns, [community]] = await Promise.all([
    db
      .select()
      .from(runs)
      .where(eq(runs.sourceId, source.id))
      .orderBy(desc(runs.startedAt))
      .limit(10),
    db.select().from(communities).where(eq(communities.id, source.communityId)).limit(1),
  ]);

  const recipe = (source.extractionRecipe ?? null) as {
    extraction_method?: string;
    instruction_block?: string;
    notes?: string;
  } | null;

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="spread">
        <div>
          <Link href="/sources" className="muted" style={{ fontSize: 13 }}>
            ← Sources
          </Link>
          <div className="page-title" style={{ marginTop: 4 }}>
            {source.name}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <Badge kind="neutral">{source.sourceType}</Badge>
            <DiscoveryStatus status={source.discoveryStatus} />
            {source.active ? <Badge kind="good">active</Badge> : <Badge kind="neutral">off</Badge>}
          </div>
        </div>
        <RunActions sourceId={source.id} discoveryStatus={source.discoveryStatus} />
      </div>

      <div className="card grid" style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        <Field
          label="Link"
          value={
            source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                {source.url.replace(/^https?:\/\//, "")}
              </a>
            ) : null
          }
        />
        <Field
          label="Review mode"
          value={
            source.mode
              ? source.mode === "restricted"
                ? "Restricted, every event reviewed"
                : "Unrestricted, publishes automatically"
              : `Community default (${community?.defaultMode ?? "restricted"})`
          }
        />
        <Field label="Extraction method" value={recipe?.extraction_method ?? "not discovered yet"} />
        <Field label="Checks for events" value={cronToLabel(source.scheduleCron)} />
        <Field label="Sponsor / org" value={source.orgName ?? source.calendarSourceName} />
      </div>

      <SourceSettings
        sourceId={source.id}
        mode={source.mode}
        schedule={cronToValue(source.scheduleCron)}
        active={source.active}
        communityDefaultMode={community?.defaultMode ?? "restricted"}
      />

      <EditSource
        sourceId={source.id}
        name={source.name}
        urls={
          Array.isArray(source.startUrls) && (source.startUrls as string[]).length
            ? (source.startUrls as string[])
            : source.url
              ? [source.url]
              : []
        }
        special={source.specialInstructions ?? ""}
      />

      <SourcePrompt sourceId={source.id} initial={source.specialInstructions ?? ""} />

      {recipe?.instruction_block && (
        <div className="card">
          <div className="label">Extraction recipe</div>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 12,
              margin: 0,
              color: "var(--muted)",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {recipe.instruction_block}
          </pre>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Runs</h3>
        {recentRuns.length === 0 ? (
          <div className="muted">No runs yet.</div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Run</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Found</th>
                <th>Dup</th>
                <th>Published</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r) => (
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
                  <td>{r.eventsDuplicate}</td>
                  <td>{r.eventsPublished}</td>
                  <td className="muted">{fmtDate(r.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
