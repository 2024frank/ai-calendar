"use client";

import { FixAllButton } from "@/app/(app)/review/FixAllButton";

/**
 * Correct this source's auto-rejected events.
 *
 * Same one-at-a-time walk and same progress bar as the review queue, scoped to
 * this source, so the count, the spend, and the resume behaviour match wherever
 * it is started from.
 */
export function CorrectButton({ sourceId, autoRejected }: { sourceId: number; autoRejected: number }) {
  if (autoRejected === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <FixAllButton initialCount={autoRejected} sourceId={sourceId} />
    </div>
  );
}
