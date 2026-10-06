/**
 * Accept only a same-origin path for post-login redirects. Rejects protocol
 * relative URLs (`//host`), backslash tricks (`/\host`), absolute URLs and any
 * control character, which browsers strip before parsing (`/\t/host`).
 */
export function safeNextPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  return value;
}
