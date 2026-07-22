import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { learnings, sources, users } from "@/db/schema";
import { isAdmin, requireUser } from "@/lib/auth";
import { currentCommunityId } from "@/lib/data";
import { Card, EmptyState, PageHeader, StatusBadge, TableShell } from "@/components/ui";
import { fmtDate } from "@/components/bits";
import { ExportButtons } from "./ExportButtons";
import { LessonActions } from "./LessonActions";

export const dynamic = "force-dynamic";

const SCOPE_TONE = { global: "success", community: "warning", source: "neutral" } as const;
const SCOPE_MEANS = {
  source: "Applies to this one website",
  community: "Applies across this community",
  global: "Applies to every source everywhere",
} as const;

export default async function LearningPage() {
  const s = await requireUser();
  if (!isAdmin(s)) redirect("/dashboard");
  const communityId = await currentCommunityId(s);

  const rows = await db
    .select({
      id: learnings.id,
      lesson: learnings.lesson,
      scope: learnings.scope,
      triggerKind: learnings.triggerKind,
      fieldName: learnings.fieldName,
      timesServed: learnings.timesServed,
      status: learnings.status,
      createdAt: learnings.createdAt,
      sourceName: sources.name,
      reviewerEmail: users.email,
      reviewerName: users.name,
    })
    .from(learnings)
    .leftJoin(sources, eq(sources.id, learnings.sourceId))
    .leftJoin(users, eq(users.id, learnings.reviewerId))
    .where(communityId ? eq(learnings.communityId, communityId) : undefined)
    .orderBy(desc(learnings.id))
    .limit(300);

  const [tally] = await db
    .select({
      total: sql<number>`sum(case when ${learnings.status} = 'active' then 1 else 0 end)`,
      global: sql<number>`sum(case when ${learnings.scope} = 'global' then 1 else 0 end)`,
      fromRejections: sql<number>`sum(case when ${learnings.triggerKind} = 'rejection' then 1 else 0 end)`,
      people: sql<number>`count(distinct ${learnings.reviewerId})`,
    })
    .from(learnings)
    .where(communityId ? eq(learnings.communityId, communityId) : undefined);

  return (
    <div className="grid" style={{ gap: 20 }}>
      <PageHeader
        eyebrow="Training Data"
        title="What reviewers have taught the agents"
        description="Every correction a person makes becomes one instruction the agents are given on their next run. Download the whole set to train a model of your own."
      />

      <Card>
        <div className="grid" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 26, flexWrap: "wrap" }}>
            <div>
              <div className="label">Lessons</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{Number(tally?.total ?? 0)}</div>
            </div>
            <div>
              <div className="label">Apply everywhere</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{Number(tally?.global ?? 0)}</div>
            </div>
            <div>
              <div className="label">From rejections</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{Number(tally?.fromRejections ?? 0)}</div>
            </div>
            <div>
              <div className="label">People who taught them</div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{Number(tally?.people ?? 0)}</div>
            </div>
          </div>
          <ExportButtons
            count={Number(tally?.total ?? 0)}
            isPlatformAdmin={s.role === "platform_admin"}
          />
        </div>
      </Card>

      <Card className="surface--flush">
        <div className="section-header" style={{ padding: "18px 20px 4px" }}>
          <div>
            <h2>Lessons</h2>
            <p>Newest first. Each one came from a person correcting or rejecting a real event.</p>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title="Nothing learned yet"
            description="Correct a field or reject an event in the review queue, and the lesson drawn from it appears here."
          />
        ) : (
          <TableShell label="Lessons learned from reviewers">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Lesson</th>
                  <th>Applies to</th>
                  <th>Learned from</th>
                  <th>Source</th>
                  <th>Taught by</th>
                  <th>Given to runs</th>
                  <th>When</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={r.status === "retired" ? { opacity: 0.5 } : undefined}>
                    <td style={{ maxWidth: 420 }}>
                      {r.lesson}
                      {r.status === "retired" && (
                        <span className="badge neutral" style={{ marginLeft: 8 }}>retired</span>
                      )}
                    </td>
                    <td>
                      <span title={SCOPE_MEANS[r.scope]}>
                        <StatusBadge tone={SCOPE_TONE[r.scope]}>
                          {r.scope === "global"
                            ? "Everywhere"
                            : r.scope === "community"
                              ? "Community"
                              : "This source"}
                        </StatusBadge>
                      </span>
                    </td>
                    <td className="muted">
                      {r.triggerKind === "rejection" ? "A rejection" : `An edit to ${r.fieldName ?? "a field"}`}
                    </td>
                    <td className="muted">{r.sourceName ?? "—"}</td>
                    <td className="muted">{r.reviewerName || r.reviewerEmail || "—"}</td>
                    <td>{r.timesServed}</td>
                    <td className="muted">{fmtDate(r.createdAt)}</td>
                    <td><LessonActions id={r.id} status={r.status} /></td>
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
