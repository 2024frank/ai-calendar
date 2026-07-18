import { requireUser } from "@/lib/auth";
import { reviewQueue } from "@/lib/data";
import { fmtDate } from "@/components/bits";

export const dynamic = "force-dynamic";

function firstSessionDate(sessions: unknown): string {
  if (!Array.isArray(sessions) || sessions.length === 0) return "—";
  const start = (sessions[0] as { startTime?: number })?.startTime;
  if (!start) return "—";
  return new Date(start * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ReviewPage() {
  const s = await requireUser();
  const rows = await reviewQueue(s);

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div>
        <div className="page-title">Review queue</div>
        <div className="muted">
          Restricted-mode events wait here for approval before publishing.
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Event</th>
              <th>Type</th>
              <th>When</th>
              <th>Location</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ padding: 20 }}>
                  Nothing waiting for review.
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.id}>
                <td style={{ fontWeight: 600 }}>{e.title ?? "(untitled)"}</td>
                <td>{e.eventType ?? "—"}</td>
                <td>{firstSessionDate(e.sessions)}</td>
                <td className="muted">
                  {(e.location ?? "").slice(0, 40) || (e.locationType === "on" ? "Online" : "—")}
                </td>
                <td className="muted">{fmtDate(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
