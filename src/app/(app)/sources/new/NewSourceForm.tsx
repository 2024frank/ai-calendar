"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Community = { id: number; name: string };

export function NewSourceForm({
  communities,
  isPlatformAdmin,
}: {
  communities: Community[];
  isPlatformAdmin: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [urls, setUrls] = useState("");
  const [sourceType, setSourceType] = useState<"web" | "email">("web");
  const [special, setSpecial] = useState("");
  const [communityId, setCommunityId] = useState<number>(communities[0]?.id ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          urls: urls.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean),
          sourceType,
          specialInstructions: special,
          communityId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create the source.");
        setBusy(false);
        return;
      }
      router.push(`/sources/${data.id}`);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <form className="card grid" style={{ gap: 14 }} onSubmit={submit}>
      {isPlatformAdmin && communities.length > 1 && (
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

      <div>
        <label className="label">Source name</label>
        <input
          className="input"
          placeholder="e.g. Oberlin Public Library"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="label">Type</label>
        <select
          className="input"
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value as "web" | "email")}
        >
          <option value="web">Website / calendar link</option>
          <option value="email">Email inbox</option>
        </select>
      </div>

      {sourceType === "web" && (
        <div>
          <label className="label">Links</label>
          <textarea
            className="input"
            rows={3}
            placeholder={"https://example.org/events\nhttps://example.org/calendar"}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            autoCapitalize="none"
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            One per line. Add every page this organization publishes events on. The first is the main one.
          </div>
        </div>
      )}

      <div>
        <label className="label">Special instructions (optional)</label>
        <textarea
          className="input"
          rows={3}
          placeholder={"Only what is unusual about THIS source. For example: the sponsor is always the Library, ignore the staff-only section, dates are day/month order."}
          value={special}
          onChange={(e) => setSpecial(e.target.value)}
        />
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Leave this empty unless the source needs it. Every agent already knows the
          house rules: what counts as an event, an announcement and a job, the
          required fields, that each event needs its own picture, and the writing
          rules including no em dashes. Only add what is specific to this source.
        </div>
      </div>

      {error && <div className="badge bad">{error}</div>}

      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create source"}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => router.push("/sources")}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
