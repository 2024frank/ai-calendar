import { requireUser } from "@/lib/auth";
import { listCommunities } from "@/lib/data";
import { NewSourceForm } from "./NewSourceForm";

export const dynamic = "force-dynamic";

export default async function NewSourcePage() {
  const s = await requireUser();
  const comms =
    s.role === "platform_admin"
      ? await listCommunities()
      : (await listCommunities()).filter((c) => c.id === s.communityId);

  return (
    <div className="grid" style={{ gap: 18, maxWidth: 640 }}>
      <div>
        <div className="page-title">Add a source</div>
        <div className="muted">
          Give it a name and a link. The Discovery Agent figures out the best way to pull its events.
        </div>
      </div>
      <NewSourceForm
        communities={comms.map((c) => ({ id: c.id, name: c.name }))}
        isPlatformAdmin={s.role === "platform_admin"}
      />
    </div>
  );
}
