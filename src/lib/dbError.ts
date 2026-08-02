/** Drizzle wraps driver errors in `cause`; inspect the chain without trusting its shape. */
export function hasDatabaseErrorCode(error: unknown, wanted: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth++) {
    if (!current || typeof current !== "object" || seen.has(current)) return false;
    seen.add(current);
    if ("code" in current && (current as { code?: unknown }).code === wanted) return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : null;
  }
  return false;
}
