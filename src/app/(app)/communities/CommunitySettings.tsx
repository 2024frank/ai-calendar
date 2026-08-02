"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  MODE_LABELS,
  REVIEW_MODES,
  normalizeMode,
  type ReviewMode,
} from "@/lib/modeLabels";

type FlushSummary = { published: number; failed: number; remaining: number };

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
  const [mode, setMode] = useState<ReviewMode>(
    normalizeMode(defaultMode) ?? "needs_approval",
  );
  const [tz, setTz] = useState(timezone);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>, rollback: () => void) {
    setBusy(true);
    setSaved(false);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/communities/${communityId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        flushed?: FlushSummary | null;
      };
      if (!res.ok) {
        throw new Error(data.error || "Could not save community settings.");
      }
      const flushed = data.flushed;
      if (flushed && (flushed.published || flushed.failed || flushed.remaining)) {
        const parts = [
          `Processed ${flushed.published} waiting event${flushed.published === 1 ? "" : "s"}`,
        ];
        if (flushed.failed) {
          parts.push(`${flushed.failed} could not be sent and stayed in review`);
        }
        if (flushed.remaining) {
          parts.push(`${flushed.remaining} remain for a later run`);
        }
        setNote(`${parts.join(". ")}.`);
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2000);
    } catch (cause) {
      rollback();
      setError(cause instanceof Error ? cause.message : "Could not save community settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr 1fr auto", gap: 12, marginTop: 12 }}>
      <div>
        <label className="label" htmlFor={`community-mode-${communityId}`}>Default review mode</label>
        <select
          id={`community-mode-${communityId}`}
          name="defaultMode"
          className="input"
          value={mode}
          disabled={busy}
          onChange={(e) => {
            const previous = mode;
            const next = e.target.value as ReviewMode;
            if (next !== "needs_approval") {
              const confirmed = window.confirm(
                `${MODE_LABELS[next].name} skips this calendar's review for every source using the community default. Any events already waiting for those sources may be sent immediately, and publishing cannot be undone.\n\nUse ${MODE_LABELS[next].name}?`,
              );
              if (!confirmed) return;
            }
            setMode(next);
            void save({ defaultMode: next }, () => setMode(previous));
          }}
        >
          {REVIEW_MODES.map((value) => (
            <option key={value} value={value}>{MODE_LABELS[value].name}</option>
          ))}
        </select>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {MODE_LABELS[mode].blurb} Sources with their own mode are unchanged.
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`community-timezone-${communityId}`}>Timezone</label>
        <select
          id={`community-timezone-${communityId}`}
          name="timezone"
          className="input"
          value={tz}
          disabled={busy}
          onChange={(e) => {
            const previous = tz;
            const next = e.target.value;
            setTz(next);
            void save({ timezone: next }, () => setTz(previous));
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
        {saved && <span className="badge good" role="status">saved</span>}
      </div>
      {note && <div role="status" className="muted" style={{ gridColumn: "1 / -1", fontSize: 13 }}>{note}</div>}
      {error && <div role="alert" style={{ color: "var(--danger)", gridColumn: "1 / -1", fontSize: 13 }}>{error}</div>}
    </div>
  );
}
