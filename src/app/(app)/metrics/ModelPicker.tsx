"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MODELS } from "@/lib/modelList";

/** Change the model used for every source's extraction, platform-wide. */
export function ModelPicker({ current }: { current: string }) {
  const router = useRouter();
  const [model, setModel] = useState(current);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const chosen = MODELS.find((m) => m.id === model);

  async function save(id: string) {
    setModel(id);
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/settings/model", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: id }),
    });
    setBusy(false);
    if (!res.ok) return setMsg("Could not switch.");
    setMsg("Switched. New runs use this model.");
    router.refresh();
    setTimeout(() => setMsg(null), 2500);
  }

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>Model</h3>
        {msg && <span className="badge good">{msg}</span>}
      </div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
        Which AI model runs extraction for every source. Change it here and all future runs use it. The
        prices are per million tokens, for comparison; the real per-run cost is measured below.
      </div>
      <select
        className="input"
        value={model}
        disabled={busy}
        onChange={(e) => save(e.target.value)}
        style={{ maxWidth: 420 }}
      >
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} — ${m.inPerM}/M in, ${m.outPerM}/M out
          </option>
        ))}
      </select>
      {chosen && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {chosen.note}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div className="label">Price reference (per million tokens)</div>
        <table className="tbl" style={{ marginTop: 4 }}>
          <thead>
            <tr>
              <th>Model</th>
              <th>Input</th>
              <th>Output</th>
            </tr>
          </thead>
          <tbody>
            {MODELS.map((m) => (
              <tr key={m.id} style={{ fontWeight: m.id === model ? 600 : 400 }}>
                <td>{m.label}{m.id === model ? " (in use)" : ""}</td>
                <td>${m.inPerM.toFixed(2)}</td>
                <td>${m.outPerM.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
