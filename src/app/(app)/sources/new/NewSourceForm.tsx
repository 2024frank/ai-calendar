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
  const [url, setUrl] = useState("");
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
        body: JSON.stringify({ name, url, sourceType, specialInstructions: special, communityId }),
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
          <label className="label">Event page link</label>
          <input
            className="input"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoCapitalize="none"
          />
        </div>
      )}

      <div>
        <label className="label">Special instructions (optional)</label>
        <textarea
          className="input"
          rows={3}
          placeholder="Anything the extractor should know — e.g. 'events live under the Calendar tab', 'sponsor is always the Library', 'ignore past events'."
          value={special}
          onChange={(e) => setSpecial(e.target.value)}
        />
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
