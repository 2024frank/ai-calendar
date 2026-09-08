export const DESTINATION_INVENTORY_HOLD = "destination_inventory_unavailable";

export function hasDestinationInventoryHold(reason?: string | null): boolean {
  return Boolean(reason?.includes(DESTINATION_INVENTORY_HOLD));
}

/** Field edits/corrections cannot resolve a failed destination duplicate check. */
export function preserveEventHolds(issues: readonly string[], previousReason?: string | null): string[] {
  return [...new Set([
    ...issues,
    ...(hasDestinationInventoryHold(previousReason) ? [DESTINATION_INVENTORY_HOLD] : []),
  ])];
}

/**
 * The same reason with the destination hold taken out, once the check has
 * actually been made. "Missing before publish: destination_inventory_unavailable"
 * becomes null; a reason with other issues keeps them.
 */
export function withoutDestinationHold(reason?: string | null): string | null {
  if (!reason || !hasDestinationInventoryHold(reason)) return reason ?? null;
  const colon = reason.indexOf(":");
  if (colon < 0) return null;
  const prefix = reason.slice(0, colon);
  const issues = reason
    .slice(colon + 1)
    .split(",")
    .map((issue) => issue.trim())
    .filter((issue) => issue && issue !== DESTINATION_INVENTORY_HOLD);
  return issues.length ? `${prefix}: ${issues.join(", ")}` : null;
}
