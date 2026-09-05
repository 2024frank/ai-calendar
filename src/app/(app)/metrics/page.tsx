import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { MINUTES_PER_MANUAL_EVENT, pilotMetrics } from "@/lib/metrics";
import { modelLabel } from "@/lib/modelList";
import { ModelPicker } from "./ModelPicker";

/** Always dollars. Small amounts get more decimals so they are not just $0.00. */
function money(v: number) {
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.1) return `$${v.toFixed(2)}`;
  if (v >= 0.001) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(4)}`;
}

function Bar({ value, max, good }: { value: number; max: number; good: boolean }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div style={{ background: "var(--chip, rgba(0,0,0,.06))", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: good ? "var(--accent)" : "var(--warn, #d08700)" }} />
    </div>
  );
}

export const dynamic = "force-dynamic";

function Stat({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="card">
      <div className="kpi">{value}</div>
      <div className="kpi-label" style={{ marginTop: 2 }}>{label}</div>
      <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.4 }}>{note}</div>
    </div>
  );
}

export default async function MetricsPage() {
  const s = await requireUser();
  // Grant-owner view only.
  if (s.role !== "platform_admin") redirect("/dashboard");

  const m = await pilotMetrics();

  return (
    <div className="grid" style={{ gap: 20, maxWidth: 1100 }}>
      <div>
        <div className="page-title">Pilot metrics</div>
        <div className="muted">
          Current operational counts across the pilot. These are not an independent measurement of extraction accuracy.
        </div>
        <Link href="/evaluations">Compare retained snapshots against an independent reference →</Link>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 14 }}>
        <Stat
          value={String(m.sourcesConnected)}
          label="Organizations connected"
          note="Local sources the system reads on its own, each on a schedule."
        />
        <Stat
          value={String(m.eventsGathered)}
          label="Events gathered"
          note="Current pending, approved and submitted records; this count can change after review or retention."
        />
        <Stat
          value={String(m.duplicatesCaught)}
          label="Flagged as duplicates"
          note="Current duplicate classifications. Their correctness has not been independently verified by this count."
        />
        <Stat
          value={m.currentUnflaggedPct === null ? "—" : `${m.currentUnflaggedPct}%`}
          label="Current unflagged records"
          note={`Share of current pending/approved/submitted records with no stored rejection reason. Review and corrections can clear these flags; this is not immutable arrival completeness. ${m.filteredIncomplete} records are currently auto-rejected.`}
        />
        <Stat
          value={m.approvedAsIsPct === null ? "—" : `${m.approvedAsIsPct}%`}
          label="Human approvals without recorded edits"
          note={
            m.approvedAsIsPct === null
              ? `No reviewer-attributed approvals yet. Automatic submissions are excluded. Reviewers have recorded ${m.totalReviewerEdits} field edits in total.`
              : `Of ${m.approvedTotal} currently approved/submitted records explicitly attributed to a reviewer, the share with no field-edit log. This is not proof that every field was correct. Reviewers recorded ${m.totalReviewerEdits} field edits in total.`
          }
        />
        <Stat
          value={`~${m.estimatedHoursSaved} hrs`}
          label="Staff time saved (estimate)"
          note={`Rough figure: ${m.eventsGathered} events times ${MINUTES_PER_MANUAL_EVENT} minutes to find and enter one by hand. An estimate, not a measurement.`}
        />
        <Stat
          value={money(m.totalSpendUsd)}
          label="AI spend so far"
          note="Real dollars billed by the API across every run, summed from what each run reported. Not an estimate."
        />
        <Stat
          value={money(m.costPerEventUsd)}
          label="Cost per event gathered"
          note="Recorded AI spend divided by the current gathered-event count; not a cost per independently verified event."
        />
        <Stat
          value={String(m.correctedCount)}
          label="Records with a correction timestamp"
          note={`Includes corrections to auto-rejected and reviewer-requested records. ${m.correctedAccepted} are currently reviewer-attributed approved/submitted records; these counts alone do not prove the corrections were right.`}
        />
      </div>

      <ModelPicker current={m.activeModel} />

      {m.byModel.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 4 }}>Model comparison</h3>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Extraction-run totals only, not a controlled model comparison. Correction, discovery and learning runs are excluded. Source mix, periods and review effort may differ.
          </div>
          {(() => {
            const maxCPE = Math.max(...m.byModel.map((x) => x.costPerEventUsd), 0.0001);
            return (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Runs</th>
                    <th>Events</th>
                    <th style={{ minWidth: 160 }}>Passed validation</th>
                    <th>Spend</th>
                    <th style={{ minWidth: 160 }}>Cost per event</th>
                  </tr>
                </thead>
                <tbody>
                  {m.byModel.map((x) => (
                    <tr key={x.model}>
                      <td style={{ fontWeight: 600 }}>
                        {modelLabel(x.model)}
                        {x.model === m.activeModel ? " (in use)" : ""}
                      </td>
                      <td>{x.runs}</td>
                      <td>{x.eventsExtracted}</td>
                      <td>
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <span style={{ width: 34, fontSize: 12 }}>{x.cleanPct === null ? "—" : `${x.cleanPct}%`}</span>
                          <div style={{ flex: 1 }}><Bar value={x.cleanPct ?? 0} max={100} good /></div>
                        </div>
                      </td>
                      <td>{money(x.costUsd)}</td>
                      <td>
                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <span style={{ width: 48, fontSize: 12 }}>{money(x.costPerEventUsd)}</span>
                          {/* Shorter bar is cheaper, so invert: cheap = long green. */}
                          <div style={{ flex: 1 }}>
                            <Bar value={maxCPE - x.costPerEventUsd} max={maxCPE} good />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Passing validation is not evidence of factual accuracy. Compare retained independent references with consistent scope before drawing quality conclusions.
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: 4 }}>By organization</h3>
        <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Current source-level status and review counts. The unflagged share can change after corrections and approval.
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Organization</th>
              <th>Events gathered</th>
              <th>Currently unflagged</th>
              <th>Flagged duplicates</th>
              <th>Reviewer edits</th>
            </tr>
          </thead>
          <tbody>
            {m.bySource.map((r) => (
              <tr key={r.name}>
                <td style={{ fontWeight: 600 }}>{r.name}</td>
                <td>{r.gathered}</td>
                <td>
                  {r.gathered
                    ? `${Math.round((r.currentUnflagged / r.gathered) * 100)}%`
                    : "—"}
                </td>
                <td className="muted">{r.duplicatesCaught}</td>
                <td className="muted">{r.editsNeeded}</td>
              </tr>
            ))}
            {m.bySource.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ padding: 16 }}>
                  No events gathered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>How to read this for the grant</h3>
        <div className="grid" style={{ gap: 8, fontSize: 14, lineHeight: 1.5 }}>
          <div>
            <strong>Does AI reduce the manual work?</strong> Look at events gathered and the time-saved
            estimate. Validate the estimate with a timed human workflow study; time saved has not been measured here.
          </div>
          <div>
            <strong>How accurate is the extraction?</strong> These operational counts cannot answer that alone.
            Retained comparisons provide explicit reference scope, human-confirmed matches, unmatched lists and field differences.
          </div>
          <div>
            <strong>Does it reduce fragmentation?</strong> Duplicate classifications are a workflow signal; independent review is needed to verify their correctness.
          </div>
          <div>
            <strong>Is a person always in control?</strong> Yes. Nothing here published without review unless a
            source was deliberately set to automatic delivery. Human-approval figures exclude automatic submissions without reviewer attribution.
          </div>
        </div>
      </div>
    </div>
  );
}
