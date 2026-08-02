"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Edit a source's name and links. SourcePrompt is the sole prompt owner. */
export function EditSource({
  sourceId,
  name: initialName,
  urls: initialUrls,
}: {
  sourceId: number;
  name: string;
  urls: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [urls, setUrls] = useState(initialUrls.join("\n"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const dirty = name !== initialName || urls !== initialUrls.join("\n");

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const patch: Record<string, unknown> = {};
      if (name !== initialName) patch.name = name;
      if (urls !== initialUrls.join("\n")) {
        patch.urls = urls
          .split(/[\n,]+/)
          .map((u) => u.trim())
          .filter(Boolean);
      }
      const res = await fetch(`/api/sources/${sourceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.error || "Could not save.");
        return;
      }

      setMsg("Saved.");
      router.refresh();
      setTimeout(() => setMsg(null), 2500);
    } catch {
      setMsg("Network error. Nothing was saved.");
    } finally {
      setBusy(false);
    }
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
            <label className="label" htmlFor="edit-source-name">Source name</label>
            <input id="edit-source-name" name="name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <label className="label" htmlFor="edit-source-links">Links</label>
            <textarea
              id="edit-source-links"
              name="urls"
              className="input"
              rows={3}
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              autoCapitalize="none"
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              One per line. If you change the links, update the instructions below to match.
            </div>
          </div>

          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <button className="btn primary" type="button" disabled={busy || !dirty} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            {msg && (
              <span role="status" className={`badge ${msg === "Saved." ? "good" : "bad"}`}>{msg}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
