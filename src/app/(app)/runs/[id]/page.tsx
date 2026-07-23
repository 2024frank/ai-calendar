import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { runs, sources } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { currentCommunityId } from "@/lib/data";
import { reapStaleRuns } from "@/lib/retention";
import { RunStatus, fmtDate } from "@/components/bits";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { LiveTimeline } from "./LiveTimeline";

export const dynamic = "force-dynamic";
const numberFormatter = new Intl.NumberFormat("en-US");

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  await reapStaleRuns().catch(() => undefined);
  const [run] = await db.select().from(runs).where(eq(runs.id, Number(id))).limit(1);
  if (!run) notFound();
  const communityId = await currentCommunityId(session);
  if (session.role !== "platform_admin" && (!communityId || run.communityId !== communityId)) {
    notFound();
  }
  const [source] = run.sourceId ? await db.select().from(sources).where(eq(sources.id, run.sourceId)).limit(1) : [null];
  const backHref = source ? `/sources/${source.id}` : "/dashboard";

  return (
    <div className="grid" style={{ gap: 22 }}>
      <PageHeader
        eyebrow={run.runKind}
        title={`Run #${run.id}`}
        description={<>Started {fmtDate(run.startedAt)}{run.finishedAt ? <> · Finished {fmtDate(run.finishedAt)}</> : <> · Updates live</>}</>}
        actions={<><RunStatus status={run.status} /><ButtonLink href={backHref} icon="arrow-left">{source?.name || "Dashboard"}</ButtonLink></>}
      />
      <section className="kpi-grid" aria-label="Run metrics">
        {[
          ["Found", run.eventsFound, "Candidates discovered"],
          ["To Review", run.eventsExtracted, "Queued for a reviewer"],
          ["Duplicates", run.eventsDuplicate, "Prevented from republishing"],
          ["With Issues", run.eventsInvalid, "Needs more information"],
          ["Tokens", run.promptTokens + run.completionTokens, "Model usage"],
        ].map(([label, value, hint]) => (
          <Card className="kpi-card" key={label as string}>
            <div className="kpi-card__top"><span>{label}</span></div>
            <div className="kpi">{numberFormatter.format(value as number)}</div>
            <div className="kpi-card__hint">{hint}</div>
          </Card>
        ))}
      </section>
      <Card><LiveTimeline runId={run.id} /></Card>
    </div>
  );
}
