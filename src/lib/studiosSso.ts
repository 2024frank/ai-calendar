import { createHash, timingSafeEqual } from "crypto";

export function isUsableSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 32;
}

/** Constant-time check of an `Authorization: Bearer <secret>` header. */
export function bearerMatches(header: string | null, secret: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? "");
  if (!match) return false;
  // Hash both sides so the comparison length never depends on the input.
  const given = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
