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
