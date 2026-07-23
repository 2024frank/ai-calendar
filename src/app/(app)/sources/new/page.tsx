import { redirect } from "next/navigation";
import { isAdmin, requireUser } from "@/lib/auth";
import { accessibleCommunities } from "@/lib/data";
import { NewSourceForm } from "./NewSourceForm";

export const dynamic = "force-dynamic";

export default async function NewSourcePage() {
  const s = await requireUser();
  if (!isAdmin(s)) redirect("/review");
  const comms = await accessibleCommunities(s);

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
