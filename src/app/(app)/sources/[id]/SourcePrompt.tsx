"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Edit and save this source's prompt (its special instructions). Always visible,
 * because this is the main thing an admin tunes about a source.
 */
export function SourcePrompt({
  sourceId,
  initial,
}: {
  sourceId: number;
  initial: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const dirty = text !== initial;

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ specialInstructions: text }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setMsg(d.error || "Could not save.");
      return;
    }
    setMsg("Saved.");
    router.refresh();
    setTimeout(() => setMsg(null), 2500);
  }

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 8 }}>
        <h3>Source prompt</h3>
        {msg && <span className={`badge ${msg === "Saved." ? "good" : "bad"}`}>{msg}</span>}
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Only what is unusual about this source. The house rules (event types, the
        fields, one image per event, no em dashes) are built in and always apply.
      </div>
      <textarea
        className="input"
        style={{ minHeight: 220, fontFamily: "ui-monospace, monospace", fontSize: 13, lineHeight: 1.5 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="For example: the sponsor is always {source_name}; skip anything before {today}; classes are announcements titled 'Class: <name>'."
      />
      <div className="muted" style={{ fontSize: 12, margin: "6px 0" }}>
        Placeholders you can use:{" "}
        {["{source_name}", "{url}", "{urls}", "{today}", "{org_name}", "{contact_email}", "{phone}"].map((p) => (
          <code
            key={p}
            style={{ background: "var(--chip, rgba(0,0,0,.06))", padding: "1px 5px", borderRadius: 4, marginRight: 4 }}
          >
            {p}
          </code>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" type="button" onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save prompt"}
        </button>
        {dirty && (
          <button className="btn" type="button" onClick={() => setText(initial)} disabled={busy}>
            Revert
          </button>
        )}
      </div>
    </div>
  );
}
