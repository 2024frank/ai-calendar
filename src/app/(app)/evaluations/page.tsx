import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { evaluations, sources } from "@/db/schema";
import { isAdmin, requireUser } from "@/lib/auth";
import { currentCommunityId } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { EvaluationWorkspace } from "./EvaluationWorkspace";

export const dynamic = "force-dynamic";

export default async function EvaluationsPage() {
  const session = await requireUser();
  if (!isAdmin(session)) redirect("/dashboard");
  const communityId = await currentCommunityId(session);
  if (!communityId) redirect("/dashboard");
  const sourceRows = await db.select({ id: sources.id, name: sources.name }).from(sources).where(eq(sources.communityId, communityId)).orderBy(sources.name);
  const rows = await db.select({ id: evaluations.id, title: evaluations.title, createdAt: evaluations.createdAt }).from(evaluations).where(eq(evaluations.communityId, communityId)).orderBy(desc(evaluations.id)).limit(100);
  return <div className="grid" style={{ gap: 20, minWidth: 0 }}>
    <PageHeader eyebrow="Research evidence" title="Retained source comparisons" description="Compare uploaded snapshots with independent reference records and explicit human matches. This does not fetch sources, run AI, edit events, or publish anything." />
    <EvaluationWorkspace sources={sourceRows} evaluations={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} />
  </div>;
}
