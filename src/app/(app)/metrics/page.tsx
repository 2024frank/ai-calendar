import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { MINUTES_PER_MANUAL_EVENT, pilotMetrics } from "@/lib/metrics";

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
          Plain numbers for the AI micro-grant, straight from what the system has actually done. Every
          number is live.
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        <Stat
          value={String(m.sourcesConnected)}
          label="Organizations connected"
          note="Local sources the system reads on its own, each on a schedule."
        />
        <Stat
          value={String(m.eventsGathered)}
          label="Events gathered"
          note="Real events pulled off those sites and handed over ready to review. A person did not hunt for or type any of these."
        />
        <Stat
          value={String(m.duplicatesCaught)}
          label="Reposts avoided"
          note="Events already on the community calendar that the system recognized and did not post twice."
        />
        <Stat
          value={`${m.completeOnArrivalPct}%`}
          label="Complete on arrival"
          note={`Of the events handed to a reviewer, the share that came in with every field filled. Separately, the system caught ${m.filteredIncomplete} incomplete events and held them back before anyone had to look.`}
        />
        <Stat
          value={m.approvedAsIsPct === null ? "—" : `${m.approvedAsIsPct}%`}
          label="Approved with no edits"
          note={
            m.approvedAsIsPct === null
              ? `No events approved yet, so nothing to measure here. Across everything, reviewers have made ${m.totalReviewerEdits} field edit(s) in total.`
              : `Of ${m.approvedTotal} events a person approved, the share they kept exactly as the AI wrote them. Reviewers made ${m.totalReviewerEdits} field edit(s) in total.`
          }
        />
        <Stat
          value={`~${m.estimatedHoursSaved} hrs`}
          label="Staff time saved (estimate)"
          note={`Rough figure: ${m.eventsGathered} events times ${MINUTES_PER_MANUAL_EVENT} minutes to find and enter one by hand. An estimate, not a measurement.`}
        />
        <Stat
          value={m.totalSpendUsd < 1 ? `${(m.totalSpendUsd * 100).toFixed(1)}¢` : `$${m.totalSpendUsd.toFixed(2)}`}
          label="AI spend so far"
          note="Real dollars billed by the API across every run, no estimate. This is the whole cost of running the system to date."
        />
        <Stat
          value={m.costPerEventUsd < 1 ? `${(m.costPerEventUsd * 100).toFixed(1)}¢` : `$${m.costPerEventUsd.toFixed(2)}`}
          label="Cost per event gathered"
          note="Total AI spend divided by events gathered. The bottom-line number for the grant: what one usable event costs to produce."
        />
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 4 }}>By organization</h3>
        <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
          Which sources are easy for the AI and which are hard. A low complete-on-arrival number means
          that site hides fields the model has to work harder for.
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Organization</th>
              <th>Events gathered</th>
              <th>Complete on arrival</th>
              <th>Reposts avoided</th>
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
                    ? `${Math.round((r.completeOnArrival / r.gathered) * 100)}%`
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
            estimate. Each one is an event a volunteer did not have to find and type.
          </div>
          <div>
            <strong>How accurate is the extraction?</strong> Complete-on-arrival and approved-with-no-edits
            together say how often the AI got it right with no human fixing. The reviewer-edit count is the
            honest measure of how much oversight is still needed.
          </div>
          <div>
            <strong>Does it reduce fragmentation?</strong> Reposts avoided shows the system recognizing the
            same event across sources and the existing calendar, which is the duplicate problem the grant set
            out to solve.
          </div>
          <div>
            <strong>Is a person always in control?</strong> Yes. Nothing here published without review unless a
            source was deliberately set to auto-publish. The edit and repost numbers come from that human step.
          </div>
        </div>
      </div>
    </div>
  );
}
