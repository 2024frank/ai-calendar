"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Configure a community's publishing endpoint from just its base URL. */
export function EndpointEditor({
  communityId,
  currentName,
  currentApiBase,
  currentActive,
}: {
  communityId: number;
  currentName: string;
  currentApiBase: string;
  currentActive: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(currentName);
  const [apiBase, setApiBase] = useState(currentApiBase);
  const [active, setActive] = useState(currentActive);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/communities/${communityId}/endpoint`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, apiBase, active }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(d.error || "Could not save.");
    setMsg("Saved.");
    router.refresh();
    setTimeout(() => setMsg(null), 2000);
  }

  return (
    <div className="grid" style={{ gap: 10, marginTop: 12, borderTop: "1px solid var(--line, #eee)", paddingTop: 12 }}>
      <div className="label">Publishing endpoint</div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label className="label" style={{ fontWeight: 400 }}>Endpoint base URL</label>
          <input
            className="input"
            placeholder="https://cleveland.communityhub.cloud"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            autoCapitalize="none"
          />
        </div>
        <div>
          <label className="label" style={{ fontWeight: 400 }}>Name</label>
          <input className="input" placeholder="Cleveland CommunityHub" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <label className="row" style={{ gap: 8, alignItems: "center", cursor: "pointer" }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <span>Publish approved events to this endpoint</span>
      </label>
      <div className="muted" style={{ fontSize: 12 }}>
        Paste the community&apos;s CommunityHub base URL. The submit and inventory paths follow the standard
        pattern automatically. Turn it on and this community is ready: add sources and their events flow
        here. Leave it off to keep events in the AI calendar only.
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" type="button" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save endpoint"}
        </button>
        {msg && <span className={`badge ${msg === "Saved." ? "good" : "bad"}`}>{msg}</span>}
      </div>
    </div>
  );
}
