import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listSources, reviewQueue } from "@/lib/data";
import { fmtDate } from "@/components/bits";

export const dynamic = "force-dynamic";

function firstSessionDate(sessions: unknown): string {
  if (!Array.isArray(sessions) || sessions.length === 0) return "—";
  const start = (sessions[0] as { startTime?: number })?.startTime;
  if (!start) return "—";
  return new Date(start * 1000).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ReviewPage() {
  const s = await requireUser();
  const [rows, srcs] = await Promise.all([reviewQueue(s), listSources(s)]);
  const sourceName = new Map(srcs.map((x) => [x.id, x.name]));

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div>
        <div className="page-title">Review queue</div>
        <div className="muted">
          Open an event to check it, fix anything wrong, then approve or reject. Your decisions train
          the agent.
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Event</th>
              <th>Source</th>
              <th>When</th>
              <th>Location</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: 20 }}>
                  Nothing waiting for review.
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link
                    href={`/review/${e.id}`}
                    style={{ color: "var(--accent)", fontWeight: 600 }}
                  >
                    {e.title ?? "(untitled)"}
                  </Link>
                  {e.rejectionReason && (
                    <div className="badge warn" style={{ marginTop: 4 }}>
                      needs attention
                    </div>
                  )}
                </td>
                <td className="muted">{sourceName.get(e.sourceId ?? -1) ?? "—"}</td>
                <td>{firstSessionDate(e.sessions)}</td>
                <td className="muted">
                  {(e.location ?? "").slice(0, 34) || (e.locationType === "on" ? "Online" : "—")}
                </td>
                <td className="muted">{fmtDate(e.createdAt)}</td>
                <td>
                  <Link className="btn" href={`/review/${e.id}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
