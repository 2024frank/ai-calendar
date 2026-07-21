"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LOOKAHEAD_OPTIONS, SCHEDULE_OPTIONS } from "@/lib/schedule";

export function SourceSettings({
  sourceId,
  mode,
  schedule,
  active,
  communityDefaultMode,
  lookaheadDays,
  pendingCount,
}: {
  sourceId: number;
  mode: "restricted" | "unrestricted" | null;
  schedule: string;
  active: boolean;
  communityDefaultMode: string;
  lookaheadDays: number | null;
  /** Events waiting in review for this source right now. */
  pendingCount: number;
}) {
  const router = useRouter();
  const [m, setM] = useState<string>(mode ?? "inherit");
  const [sch, setSch] = useState(schedule);
  const [ahead, setAhead] = useState<number>(lookaheadDays ?? 14);
  const [on, setOn] = useState(active);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setSaved(false);
    setNote(null);
    const res = await fetch(`/api/sources/${sourceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = (await res.json().catch(() => ({}))) as {
      flushed?: { published: number; failed: number; remaining: number } | null;
    };
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      // Say what the switch actually did to the queue, so publishing a backlog
      // is never a silent surprise.
      const f = data.flushed;
      if (f && (f.published || f.failed || f.remaining)) {
        const parts = [`Published ${f.published} waiting event${f.published === 1 ? "" : "s"}`];
        if (f.failed) parts.push(`${f.failed} could not be sent and stayed in review`);
        if (f.remaining) parts.push(`${f.remaining} still to go, they publish on the next run`);
        setNote(parts.join(". ") + ".");
      }
      router.refresh();
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 12 }}>
        <h3>Settings</h3>
        {saved && <span className="badge good">saved</span>}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
        <div>
          <label className="label">Review mode</label>
          <select
            className="input"
            value={m}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value;
              const becomesUnrestricted =
                next === "unrestricted" ||
                (next === "inherit" && communityDefaultMode === "unrestricted");
              // Publishing a backlog to CommunityHub cannot be taken back, so
              // the number goes in front of the person before it happens.
              if (becomesUnrestricted && pendingCount > 0) {
                const ok = window.confirm(
                  `This publishes the ${pendingCount} event${pendingCount === 1 ? "" : "s"} waiting in review to CommunityHub right away, and every new one after that goes straight through without review.\n\nPublish them now?`,
                );
                if (!ok) return;
              }
              setM(next);
              save({ mode: next === "inherit" ? null : next });
            }}
          >
            <option value="inherit">Use community default ({communityDefaultMode})</option>
            <option value="restricted">Restricted, review every event</option>
            <option value="unrestricted">Unrestricted, publish automatically</option>
          </select>
        </div>

        <div>
          <label className="label">How often to check</label>
          <select
            className="input"
            value={sch}
            disabled={busy}
            onChange={(e) => {
              setSch(e.target.value);
              save({ schedule: e.target.value });
            }}
          >
            {SCHEDULE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">How far ahead to look</label>
          <select
            className="input"
            value={ahead}
            disabled={busy}
            onChange={(e) => {
              const next = Number(e.target.value);
              setAhead(next);
              save({ lookaheadDays: next });
            }}
          >
            {LOOKAHEAD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Status</label>
          <select
            className="input"
            value={on ? "on" : "off"}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value === "on";
              setOn(next);
              save({ active: next });
            }}
          >
            <option value="on">Active</option>
            <option value="off">Paused</option>
          </select>
        </div>
      </div>

      {note && (
        <p className="muted" style={{ fontSize: 12, margin: "12px 0 0" }}>
          {note}
        </p>
      )}
    </div>
  );
}
