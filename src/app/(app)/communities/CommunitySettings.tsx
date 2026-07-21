"use client";

import { MODE_LABELS, REVIEW_MODES } from "@/lib/modeLabels";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CommunitySettings({
  communityId,
  defaultMode,
  timezone,
}: {
  communityId: number;
  defaultMode: string;
  timezone: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(defaultMode);
  const [tz, setTz] = useState(timezone);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setSaved(false);
    const res = await fetch(`/api/communities/${communityId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr 1fr auto", gap: 12, marginTop: 12 }}>
      <div>
        <label className="label">Default review mode for new sources</label>
        <select
          className="input"
          value={mode}
          disabled={busy}
          onChange={(e) => {
            setMode(e.target.value);
            save({ defaultMode: e.target.value });
          }}
        >
          <option value="restricted">Restricted, review every event</option>
          <option value="unrestricted">Unrestricted, publish automatically</option>
        </select>
      </div>
      <div>
        <label className="label">Timezone</label>
        <select
          className="input"
          value={tz}
          disabled={busy}
          onChange={(e) => {
            setTz(e.target.value);
            save({ timezone: e.target.value });
          }}
        >
          {[
            "America/New_York",
            "America/Chicago",
            "America/Denver",
            "America/Los_Angeles",
          ].map((z) => (
            <option key={z} value={z}>
              {z.replace("America/", "").replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      <div style={{ alignSelf: "end", paddingBottom: 10 }}>
        {saved && <span className="badge good">saved</span>}
      </div>
    </div>
  );
}
