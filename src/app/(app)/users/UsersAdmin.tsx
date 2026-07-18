"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type UserRow = {
  id: number;
  email: string;
  name: string | null;
  role: string;
  communityId: number | null;
  status: string;
};
type Opt = { id: number; name: string };

export function UsersAdmin({
  users,
  communities,
  sources,
  isPlatformAdmin,
  myCommunityId,
}: {
  users: UserRow[];
  communities: Opt[];
  sources: Opt[];
  isPlatformAdmin: boolean;
  myCommunityId: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("reviewer");
  const [communityId, setCommunityId] = useState<number>(
    myCommunityId ?? communities[0]?.id ?? 0,
  );
  const [sourceIds, setSourceIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);

  const communityName = new Map(communities.map((c) => [c.id, c.name]));

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInviteLink(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name, role, communityId, sourceIds }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not invite.");
      return;
    }
    setEmailed(Boolean(d.emailed));
    if (d.inviteLink) setInviteLink(d.inviteLink);
    setEmail("");
    setName("");
    setSourceIds([]);
    router.refresh();
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="spread">
        <div>
          <div className="page-title">Users</div>
          <div className="muted">Admins manage sources and settings. Reviewers work the queue.</div>
        </div>
        <button className="btn primary" onClick={() => setOpen(!open)}>
          {open ? "Close" : "+ Invite user"}
        </button>
      </div>

      {open && (
        <form className="card grid" style={{ gap: 12 }} onSubmit={invite}>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="them@example.org"
                required
              />
            </div>
            <div>
              <label className="label">Name (optional)</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="reviewer">Reviewer</option>
                <option value="community_admin">Community admin</option>
                {isPlatformAdmin && <option value="platform_admin">Platform admin</option>}
              </select>
            </div>
            {isPlatformAdmin && role !== "platform_admin" && (
              <div>
                <label className="label">Community</label>
                <select
                  className="input"
                  value={communityId}
                  onChange={(e) => setCommunityId(Number(e.target.value))}
                >
                  {communities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {role === "reviewer" && (
            <div>
              <label className="label">
                Which sources can they review? (none selected means all in their community)
              </label>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {sources.map((s) => {
                  const on = sourceIds.includes(s.id);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className={`badge ${on ? "good" : "neutral"}`}
                      style={{ border: "none", cursor: "pointer" }}
                      onClick={() =>
                        setSourceIds(on ? sourceIds.filter((x) => x !== s.id) : [...sourceIds, s.id])
                      }
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {error && <div className="badge bad">{error}</div>}
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy || !email}>
              {busy ? "Inviting…" : "Send invitation"}
            </button>
          </div>
        </form>
      )}

      {inviteLink && (
        <div className="card" style={{ borderColor: "var(--accent)" }}>
          <div className="label">Invitation created</div>
          <p className="muted" style={{ marginTop: 0 }}>
            Email delivery is not configured yet, so send them this sign-in link. It is valid for 7
            days.
          </p>
          <div
            style={{
              background: "var(--accent-soft)",
              padding: 10,
              borderRadius: 8,
              wordBreak: "break-all",
              fontSize: 12,
            }}
          >
            {inviteLink}
          </div>
        </div>
      )}
      {emailed && !inviteLink && <div className="badge good">Invitation email sent.</div>}

      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Community</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.email}</td>
                <td>{u.name ?? "—"}</td>
                <td>{u.role.replace(/_/g, " ")}</td>
                <td className="muted">
                  {u.communityId ? (communityName.get(u.communityId) ?? u.communityId) : "all"}
                </td>
                <td>
                  <span className={`badge ${u.status === "active" ? "good" : "neutral"}`}>
                    {u.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
