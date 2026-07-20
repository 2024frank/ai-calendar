"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Edit a source's name, its links, and its special instructions. */
export function EditSource({
  sourceId,
  name: initialName,
  urls: initialUrls,
  special: initialSpecial,
}: {
  sourceId: number;
  name: string;
  urls: string[];
  special: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [urls, setUrls] = useState(initialUrls.join("\n"));
  const [special, setSpecial] = useState(initialSpecial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const dirty =
    name !== initialName ||
    urls !== initialUrls.join("\n") ||
    special !== initialSpecial;

  async function save(alsoRediscover: boolean) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        urls: urls.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean),
        specialInstructions: special,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setMsg(data.error || "Could not save.");
      return;
    }

    // If the links changed, discovery was reset. Offer to rebuild the recipe now.
    if (alsoRediscover && data.rediscover) {
      await fetch(`/api/sources/${sourceId}/discover`, { method: "POST" });
    }
    setBusy(false);
    setMsg("Saved.");
    router.refresh();
    setTimeout(() => setMsg(null), 2500);
  }

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: open ? 12 : 0 }}>
        <h3>Edit source</h3>
        <button className="btn" type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Edit"}
        </button>
      </div>

      {open && (
        <div className="grid" style={{ gap: 14 }}>
          <div>
            <label className="label">Source name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <label className="label">Links</label>
            <textarea
              className="input"
              rows={3}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              autoCapitalize="none"
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              One per line. Changing the links rebuilds how events are pulled, so run
              discovery again after saving.
            </div>
          </div>

          <div>
            <label className="label">Special instructions</label>
            <textarea
              className="input"
              rows={4}
              value={special}
              onChange={(e) => setSpecial(e.target.value)}
              placeholder="Only what is unusual about this source. You can use {source_name}, {today}, {org_name}, {contact_email}."
            />
          </div>

          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <button
              className="btn primary"
              type="button"
              disabled={busy || !dirty}
              onClick={() => save(false)}
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy || !dirty}
              onClick={() => save(true)}
              title="Save, then rebuild the extraction recipe from the new links"
            >
              Save and re-discover
            </button>
            {msg && (
              <span className={`badge ${msg === "Saved." ? "good" : "bad"}`}>{msg}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
