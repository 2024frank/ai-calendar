"use client";

import { useState } from "react";

/**
 * Download the corrections corpus.
 *
 * Three shapes because three things get done with it: JSONL to train on, CSV
 * to open in a spreadsheet, JSON to read. The browser does the download, so
 * nobody needs a terminal or an API token to get the data out.
 */
export function ExportButtons({
  count,
  isPlatformAdmin,
}: {
  count: number;
  isPlatformAdmin: boolean;
}) {
  const [everyCommunity, setEveryCommunity] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function download(format: "jsonl" | "csv" | "json") {
    setBusy(format);
    try {
      const params = new URLSearchParams();
      if (format !== "jsonl") params.set("format", format);
      if (everyCommunity) params.set("scope", "all");
      const res = await fetch(`/api/learnings/export${params.size ? `?${params}` : ""}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `corrections-${count}.${format === "json" ? "json" : format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="btn primary"
          type="button"
          disabled={!count || busy !== null}
          onClick={() => download("jsonl")}
        >
          {busy === "jsonl" ? "Preparing…" : "Download for training (.jsonl)"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={!count || busy !== null}
          onClick={() => download("csv")}
        >
          {busy === "csv" ? "Preparing…" : "Spreadsheet (.csv)"}
        </button>
        <button
          className="btn"
          type="button"
          disabled={!count || busy !== null}
          onClick={() => download("json")}
        >
          {busy === "json" ? "Preparing…" : "Readable (.json)"}
        </button>
      </div>

      {isPlatformAdmin && (
        <label className="row" style={{ gap: 6, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={everyCommunity}
            onChange={(e) => setEveryCommunity(e.target.checked)}
          />
          Include every community, not just the one I am working in
        </label>
      )}

      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        {count === 0
          ? "There is nothing to export yet."
          : "One record per correction: what the agent produced, what the person changed it to or why they refused it, and the instruction drawn from it."}
      </p>
    </div>
  );
}
