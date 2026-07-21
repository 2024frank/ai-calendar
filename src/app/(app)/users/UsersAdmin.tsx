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
  communityIds: number[];
};
type Opt = { id: number; name: string };

export function UsersAdmin({
  users,
  communities,
  isPlatformAdmin,
  myCommunityId,
  myUserId,
}: {
  users: UserRow[];
  communities: Opt[];
  isPlatformAdmin: boolean;
  myCommunityId: number | null;
  myUserId: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("reviewer");
  const [communityId, setCommunityId] = useState<number>(
    myCommunityId ?? communities[0]?.id ?? 0,
  );
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
      // Reviewers are community-scoped; no per-source list to send.
      body: JSON.stringify({ email, name, role, communityId, sourceIds: [] }),
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
            <div className="muted" style={{ fontSize: 13 }}>
              Reviewers can review every source in the community you choose above.
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

      <div className="grid" style={{ gap: 10 }}>
        {users.map((u) => (
          <UserCard
            key={u.id}
            user={u}
            communities={communities}
            communityName={communityName}
            isSelf={u.id === myUserId}
            isPlatformAdmin={isPlatformAdmin}
          />
        ))}
      </div>
    </div>
  );
}

/** One user row that expands into an access editor. */
function UserCard({
  user,
  communities,
  communityName,
  isSelf,
  isPlatformAdmin,
}: {
  user: UserRow;
  communities: Opt[];
  communityName: Map<number, string>;
  isSelf: boolean;
  isPlatformAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [communityIds, setCommunityIds] = useState<number[]>(user.communityIds);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Only a platform admin can assign communities. A member of two or more gets
  // the switcher, so this is where you enable "switch between communities".
  const canAssignCommunities = isPlatformAdmin && role !== "platform_admin";

  async function save() {
    if (canAssignCommunities && communityIds.length === 0) {
      return setMsg("Pick at least one community.");
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      // Reviewers are community-scoped: whole community, no per-source list.
      body: JSON.stringify({
        role,
        status,
        canReviewAllSources: true,
        sourceIds: [],
        ...(canAssignCommunities ? { communityIds } : {}),
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(d.error || "Could not save.");
    setMsg("Saved.");
    router.refresh();
    setTimeout(() => setMsg(null), 2000);
  }

  async function remove() {
    if (!confirm(`Delete ${user.email}? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(d.error || "Could not delete.");
    router.refresh();
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="spread">
        <div>
          <div style={{ fontWeight: 600 }}>{user.email}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {(user.name ? user.name + " · " : "") + user.role.replace(/_/g, " ")}
            {user.communityId ? ` · ${communityName.get(user.communityId) ?? user.communityId}` : ""}
            {user.status !== "active" ? ` · ${user.status}` : ""}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {msg && <span className={`badge ${msg === "Saved." ? "good" : "bad"}`}>{msg}</span>}
          <button className="btn" type="button" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Edit access"}
          </button>
        </div>
      </div>

      {open && (
        <div className="grid" style={{ gap: 12, marginTop: 12, borderTop: "1px solid var(--line, #eee)", paddingTop: 12 }}>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="label">Role</label>
              <select
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={isSelf}
                title={isSelf ? "You cannot change your own role." : undefined}
              >
                <option value="reviewer">Reviewer</option>
                <option value="community_admin">Community admin</option>
                {(isPlatformAdmin || user.role === "platform_admin") && (
                  <option value="platform_admin">Platform admin</option>
                )}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
          </div>

          {canAssignCommunities && (
            <div>
              <label className="label">
                Communities they can review (pick more than one so they can switch between them)
              </label>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {communities.map((c) => {
                  const on = communityIds.includes(c.id);
                  return (
                    <button
                      type="button"
                      key={c.id}
                      className={`badge ${on ? "good" : "neutral"}`}
                      style={{ border: "none", cursor: "pointer" }}
                      onClick={() =>
                        setCommunityIds(
                          on ? communityIds.filter((x) => x !== c.id) : [...communityIds, c.id],
                        )
                      }
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {communityIds.length > 1
                  ? "They can switch between these from the sidebar."
                  : "They see every source in this community. Add another to let them switch."}
              </div>
            </div>
          )}

          {role === "platform_admin" && (
            <div className="muted" style={{ fontSize: 13 }}>
              Platform admins see and switch between every community.
            </div>
          )}

          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" type="button" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save access"}
            </button>
            {!isSelf && (
              <button
                className="btn"
                type="button"
                onClick={remove}
                disabled={busy}
                style={{ color: "var(--bad, #b42318)" }}
              >
                Delete user
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
