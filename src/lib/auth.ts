import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";

const COOKIE = "ac_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type Role = "platform_admin" | "community_admin" | "reviewer";
export type Session = {
  uid: number;
  email: string;
  name: string | null;
  role: Role;
  communityId: number | null;
  canReviewAllSources: boolean;
  sessionVersion: number;
};

function secret() {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s || s.length < 16) {
    // Never let a forgeable, source-visible fallback sign real sessions.
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_JWT_SECRET must be set (32+ random chars) in production");
    }
    return new TextEncoder().encode("dev-insecure-secret-change-me-please-0123456789");
  }
  return new TextEncoder().encode(s);
}

export async function createSession(s: Session) {
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("ai-calendar")
    .setAudience("ai-calendar-web")
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  // Every login path funnels through here, so this is the one place to record it.
  const { logActivity } = await import("./activity");
  await logActivity({
    action: "login",
    actorUserId: s.uid,
    actorEmail: s.email,
    summary: `${s.email} signed in`,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, secret(), {
      algorithms: ["HS256"],
      issuer: "ai-calendar",
      audience: "ai-calendar-web",
    });
    const uid = Number(payload.uid);
    const sessionVersion = Number(payload.sessionVersion);
    if (!Number.isInteger(uid) || !Number.isInteger(sessionVersion)) return null;

    // Authorization is live, not a seven-day snapshot. Disabling, deleting,
    // demoting or explicitly revoking a user takes effect on their next request.
    const [user] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
    if (!user || user.status !== "active" || user.sessionVersion !== sessionVersion) return null;
    return {
      uid: user.id,
      email: user.email,
      name: user.name ?? null,
      role: user.role,
      communityId: user.communityId ?? null,
      canReviewAllSources: user.canReviewAllSources,
      sessionVersion: user.sessionVersion,
    };
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function requirePlatformAdmin(): Promise<Session> {
  const s = await requireUser();
  if (s.role !== "platform_admin") redirect("/dashboard");
  return s;
}

export function isAdmin(s: Session) {
  return s.role === "platform_admin" || s.role === "community_admin";
}

/** Community ids this session may act within. platform_admin => null (all). */
export function scopedCommunityId(s: Session): number | null {
  return s.role === "platform_admin" ? null : s.communityId;
}
