import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, sources } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { RunStatus, fmtDate } from "@/components/bits";
import { LiveTimeline } from "./LiveTimeline";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireUser();
  const [run] = await db
    .select()
    .from(runs)
    .where(eq(runs.id, Number(id)))
    .limit(1);
  if (!run) notFound();
  if (s.role !== "platform_admin" && run.communityId !== s.communityId) notFound();

  const [source] = run.sourceId
    ? await db.select().from(sources).where(eq(sources.id, run.sourceId)).limit(1)
    : [null];

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div>
        <Link href={source ? `/sources/${source.id}` : "/dashboard"} className="muted" style={{ fontSize: 13 }}>
          ← {source ? source.name : "Dashboard"}
        </Link>
        <div className="spread" style={{ marginTop: 4 }}>
          <div className="page-title">Run #{run.id}</div>
          <RunStatus status={run.status} />
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          {run.runKind} · started {fmtDate(run.startedAt)}
          {run.finishedAt ? ` · finished ${fmtDate(run.finishedAt)}` : ""}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        {[
          ["Found", run.eventsFound],
          ["To review", run.eventsExtracted],
          ["Duplicate", run.eventsDuplicate],
          ["With issues", run.eventsInvalid],
          ["Tokens", run.promptTokens + run.completionTokens],
        ].map(([label, value]) => (
          <div className="card" key={label as string}>
            <div className="kpi-label">{label}</div>
            <div className="kpi" style={{ fontSize: 22 }}>
              {value as number}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <LiveTimeline runId={run.id} />
      </div>
    </div>
  );
}
