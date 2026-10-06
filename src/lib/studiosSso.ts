import { SignJWT } from "jose";
import type { Session } from "@/lib/auth";
import { safeNextPath } from "@/lib/safeNext";

export { safeNextPath };

/** Studios callback URLs that are always allowed. Extra ones come from STUDIOS_RETURN_URLS. */
export const STUDIOS_DEFAULT_RETURN_URLS = [
  "https://studios.communityhb.tech/api/auth-callback",
  "https://community-hub-studios.vercel.app/api/auth-callback",
  "https://ch-orb-map.vercel.app/api/auth-callback",
];

export const STUDIOS_TOKEN_TTL_SECONDS = 120;

export function parseReturnAllowlist(extra: string | undefined): string[] {
  const added = (extra ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return [...STUDIOS_DEFAULT_RETURN_URLS, ...added];
}

/** Exact string match only. No prefix, origin or query tolerance. */
export function isAllowedReturn(value: string | null | undefined, extra: string | undefined): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return parseReturnAllowlist(extra).includes(value);
}

export function isValidState(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function isUsableSecret(secret: string | undefined): secret is string {
  return typeof secret === "string" && secret.length >= 32;
}

export async function signStudiosToken(opts: {
  session: Pick<Session, "uid" | "email" | "name" | "role" | "communityId">;
  state: string;
  secret: string;
  now?: number; // seconds since epoch, for tests
}): Promise<string> {
  const { session, state, secret } = opts;
  const iat = opts.now ?? Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: session.email,
    name: session.name,
    role: session.role,
    communityId: session.communityId,
    state,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("ai-calendar")
    .setAudience("ch-studios")
    .setSubject(String(session.uid))
    .setIssuedAt(iat)
    .setExpirationTime(iat + STUDIOS_TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}
