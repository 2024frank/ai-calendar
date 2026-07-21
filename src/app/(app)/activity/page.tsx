import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { activityActors, recentActivity } from "@/lib/activity";
import { fmtDate } from "@/components/bits";
import { ActivityFilters } from "./ActivityFilters";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  login: "Signed in",
  approve: "Approved event",
  reject: "Rejected event",
  edit: "Edited event",
  user_invited: "Invited user",
  user_updated: "Updated user",
  user_deleted: "Deleted user",
  source_added: "Added source",
  endpoint_set: "Set endpoint",
  model_switched: "Switched model",
};

const ACTION_TONE: Record<string, string> = {
  login: "neutral",
  approve: "good",
  reject: "bad",
  user_deleted: "bad",
  model_switched: "warn",
};

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string; action?: string }>;
}) {
  const s = await requireUser();
  if (s.role !== "platform_admin") redirect("/dashboard");
  const sp = await searchParams;

  const [rows, actors] = await Promise.all([
    recentActivity({
      actorUserId: sp.actor ? Number(sp.actor) : undefined,
      action: sp.action || undefined,
      limit: 300,
    }),
    activityActors(),
  ]);

  return (
    <div className="grid" style={{ gap: 18, maxWidth: 1000 }}>
      <div>
        <div className="page-title">Activity log</div>
        <div className="muted">Who signed in and what they did, newest first. Times are Oberlin time.</div>
      </div>

      <ActivityFilters
        actors={actors.map((a) => ({ id: a.id, label: a.name || a.email }))}
        actions={Object.keys(ACTION_LABEL)}
        actionLabels={ACTION_LABEL}
      />

      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: 18 }}>
                  Nothing recorded yet. Actions start appearing here as people sign in and work the queue.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDate(r.createdAt)}</td>
                <td style={{ fontWeight: 600 }}>{r.actorName || r.actorEmail || "system"}</td>
                <td>
                  <span className={`badge ${ACTION_TONE[r.action] ?? "neutral"}`}>
                    {ACTION_LABEL[r.action] ?? r.action}
                  </span>
                </td>
                <td className="muted">{r.summary || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
