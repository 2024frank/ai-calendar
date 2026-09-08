"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Events that arrived while CommunityHub could not be read wait on a hold that
 * only a check against the live feed can lift. One click makes that check for
 * every held event in the community.
 */
export function RecheckHoldsButton({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function recheck() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/events/recheck-destination", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The check could not be made.");
      setMessage(`Checked ${body.checked} against CommunityHub: ${body.duplicates} already posted there, ${body.cleared} released for review.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The check could not be made.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" onClick={recheck} disabled={busy || count === 0}>
        {busy ? "Checking CommunityHub…" : `Check ${count} held event${count === 1 ? "" : "s"} against CommunityHub`}
      </button>
      {message && <span className="muted">{message}</span>}
    </div>
  );
}
