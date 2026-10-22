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

// Chart palette: fixed hexes so the figures hold up in prints and slides.
// Accepted is the exact CommunityHub v1 green.
const OUTCOME_COLORS = {
  accepted: "#58ba51",
  awaiting: "#d99e16",
  duplicates: "#4a7fb5",
  rejected: "#c0453a",
  incomplete: "#9aa3ad",
} as const;

type Slice = { key: keyof typeof OUTCOME_COLORS; label: string; detail: string; value: number };

function pctOf(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function Donut({ slices, total }: { slices: Slice[]; total: number }) {
  const r = 80;
  const c = 2 * Math.PI * r;
  const segments = slices
    .filter((s) => s.value > 0)
    .map((s, i, arr) => ({
      slice: s,
      dash: total > 0 ? (s.value / total) * c : 0,
      offset: arr.slice(0, i).reduce((a, p) => a + (total > 0 ? (p.value / total) * c : 0), 0),
    }));
  return (
    <div style={{ position: "relative", width: 260, height: 260, flex: "0 0 auto", margin: "0 auto" }}>
      <svg viewBox="0 0 200 200" width="260" height="260" role="img" aria-label={`Outcome breakdown of ${total} events processed`}>
        <circle cx="100" cy="100" r={r} fill="none" stroke="var(--line)" strokeWidth="30" />
        {segments.map(({ slice: s, dash, offset }) => (
          <circle
            key={s.key}
            cx="100" cy="100" r={r} fill="none"
            stroke={OUTCOME_COLORS[s.key]} strokeWidth="30"
            strokeDasharray={`${Math.max(dash - 2, 0.5)} ${c - dash + 2}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 100 100)"
          >
            <title>{`${s.label}: ${s.value} (${pctOf(s.value, total)}%)`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", pointerEvents: "none" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 44, fontWeight: 700, lineHeight: 1 }}>{total}</div>
        <div className="muted" style={{ fontSize: 12, maxWidth: 110, marginTop: 6 }}>events processed</div>
      </div>
    </div>
  );
}

function StackedBar({ parts, total }: { parts: { key: keyof typeof OUTCOME_COLORS; value: number; label: string }[]; total: number }) {
  if (total <= 0) return <span className="muted">—</span>;
  return (
    <div style={{ display: "flex", height: 14, borderRadius: 4, overflow: "hidden", minWidth: 140, background: "var(--line)" }} role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: OUTCOME_COLORS[p.key] }} title={`${p.label}: ${p.value} (${pctOf(p.value, total)}%)`} />
      ))}
    </div>
  );
}

function MonthlyBars({ data }: { data: { month: string; gathered: number }[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.gathered), 1);
  const shown = data.slice(-12);
  return (
    <div className="card">
      <h3 style={{ marginBottom: 4 }}>Events gathered per month</h3>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>New events the system produced each month{data.length > 12 ? " (last 12 months)" : ""}, by the month each event first arrived.</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 150 }}>
        {shown.map((d) => (
          <div key={d.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{d.gathered}</span>
            <div style={{ width: "100%", maxWidth: 44, height: Math.max(6, (d.gathered / max) * 96), background: OUTCOME_COLORS.accepted, borderRadius: "4px 4px 0 0" }} title={`${d.month}: ${d.gathered} events`} />
            <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{d.month.slice(2)}</span>
          </div>
        ))}
      </div>
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
  const slices: Slice[] = [
    { key: "accepted", label: "Accepted onto the calendar", detail: `${m.reviewerApproved} approved by reviewers, ${m.autoPublished} published automatically`, value: m.eventsAccepted },
    { key: "awaiting", label: "Awaiting a decision", detail: "Gathered, but no reviewer decision yet", value: m.awaitingDecision },
    { key: "duplicates", label: "Duplicates caught", detail: "Already on the calendar, so they were not added again", value: m.duplicatesCaught },
    { key: "rejected", label: "Rejected by reviewers", detail: "A reviewer decided against publishing", value: m.reviewerRejected },
    { key: "incomplete", label: "Filtered as incomplete", detail: "Missing required details, caught before anyone had to look", value: m.autoRejectedLifetime },
  ];

  return (
    <div className="grid" style={{ gap: 20, maxWidth: 1100 }}>
      <div>
        <div className="page-title">Pilot metrics</div>
        <div className="muted">
          Current operational counts across the pilot. These are not an independent measurement of extraction accuracy.
        </div>
        <Link href="/evaluations">Compare retained snapshots against an independent reference →</Link>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 4 }}>Where every event ended up</h3>
        <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
          Every candidate event the system has processed since the pilot began, counted once by its final outcome. The five figures add up to the total in the middle.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "center" }}>
          <Donut slices={slices} total={m.totalFound} />
          <div style={{ flex: "1 1 320px", display: "grid", gap: 12 }}>
            {slices.map((sl) => (
              <div key={sl.key} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ width: 14, height: 14, borderRadius: 4, background: OUTCOME_COLORS[sl.key], flex: "0 0 auto", marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700 }}>{sl.label}</span>
                  <div className="muted" style={{ fontSize: 12 }}>{sl.detail}</div>
                </div>
                <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  <strong style={{ fontSize: 17 }}>{sl.value}</strong> <span className="muted">({pctOf(sl.value, m.totalFound)}%)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.55, margin: "18px 0 0" }}>
          Of the {m.totalFound} events the system found, <strong>{m.eventsAccepted} ({pctOf(m.eventsAccepted, m.totalFound)}%) reached the community calendar</strong> — {m.reviewerApproved} after a reviewer approved them and {m.autoPublished} published automatically. It kept {m.duplicatesCaught} duplicates off the calendar and filtered out {m.autoRejectedLifetime} incomplete listings before anyone had to look at them. Reviewers rejected {m.reviewerRejected}, and {m.awaitingDecision} are still awaiting a decision.
        </p>
      </div>

      <MonthlyBars data={m.monthlyGathered} />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 14 }}>
        <Stat
          value={String(m.sourcesConnected)}
          label="Organizations connected"
          note="Local sources the system reads on its own, each on a schedule."
        />
        <Stat
          value={String(m.eventsGathered)}
          label="Events gathered"
          note="Every new event the system has produced since the pilot began — sent to review or published automatically — including events that have since happened and been cleared."
        />
        <Stat
          value={String(m.eventsAccepted)}
          label="Accepted onto the calendar"
          note={`${m.reviewerApproved} approved by reviewers plus ${m.autoPublished} published automatically by sources set to automatic delivery. Counted from the permanent audit log and run records, so events that have already happened still count.`}
        />
        <Stat
          value={String(m.duplicatesCaught)}
          label="Duplicates caught"
          note="Every incoming event the system judged already present, since the pilot began. Their correctness has not been independently verified by this count."
        />
        <Stat
          value={String(m.reviewerRejected)}
          label="Rejected by reviewers"
          note={
            m.approvalRatePct === null
              ? "No reviewer decisions yet."
              : `Reviewers approved ${m.approvalRatePct}% of the events they decided (${m.reviewerApproved} of ${m.reviewerApproved + m.reviewerRejected}), counted by each event's latest decision. Another ${m.autoRejectedLifetime} incomplete listings were filtered automatically, and ${m.awaitingDecision} gathered events still await a decision.`
          }
        />
        <Stat
          value={m.currentUnflaggedPct === null ? "—" : `${m.currentUnflaggedPct}%`}
          label="Current unflagged records"
          note={`Share of current pending/approved/submitted records with no stored rejection reason. Review and corrections can clear these flags; this is not immutable arrival completeness. ${m.filteredIncomplete} records are currently auto-rejected.`}
        />
        <Stat
          value={m.approvedAsIsPct === null ? "—" : `${m.approvedAsIsPct}%`}
          label="Approved without corrections"
          note={
            m.approvedAsIsPct === null
              ? `No reviewer-attributed approvals yet. Automatic submissions are excluded. Reviewers have recorded ${m.totalReviewerEdits} field edits in total.`
              : `Of ${m.approvedTotal} reviewer approvals, the share where the reviewer corrected nothing the agent produced before approving. Filling in a field the agent is never asked for does not count as a correction. This is not proof that every field was correct.`
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
          note="Recorded AI spend divided by every event gathered since the pilot began; not a cost per independently verified event."
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
          Lifetime totals for the whole pilot, including events that already happened and were cleared away. Accepted is reviewer approvals plus automatic publishes; the bar shows how everything found for that organization ended up, in the same colors as the chart above.
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Organization</th>
              <th style={{ minWidth: 180 }}>Outcome mix</th>
              <th>Gathered</th>
              <th>Accepted</th>
              <th>Rejected</th>
              <th>Duplicates</th>
              <th>Incomplete</th>
            </tr>
          </thead>
          <tbody>
            {m.bySource.map((r) => {
              const acceptedTotal = r.accepted + r.autoPublished;
              const awaiting = Math.max(0, r.gathered - acceptedTotal - r.rejected);
              const rowTotal = acceptedTotal + awaiting + r.rejected + r.duplicatesCaught + r.autoRejected;
              return (
                <tr key={r.name}>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td>
                    <StackedBar
                      total={rowTotal}
                      parts={[
                        { key: "accepted", value: acceptedTotal, label: "Accepted" },
                        { key: "awaiting", value: awaiting, label: "Awaiting a decision" },
                        { key: "duplicates", value: r.duplicatesCaught, label: "Duplicates" },
                        { key: "rejected", value: r.rejected, label: "Rejected" },
                        { key: "incomplete", value: r.autoRejected, label: "Incomplete" },
                      ]}
                    />
                  </td>
                  <td>{r.gathered}</td>
                  <td>{acceptedTotal}{r.autoPublished ? <span className="muted"> ({r.accepted} + {r.autoPublished} auto)</span> : null}</td>
                  <td>{r.rejected}</td>
                  <td>{r.duplicatesCaught}</td>
                  <td>{r.autoRejected}</td>
                </tr>
              );
            })}
            {m.bySource.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 16 }}>
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
