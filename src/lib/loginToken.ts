import "server-only";

import { createHash } from "crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { loginTokens, users } from "@/db/schema";

type LoginKind = "magic" | "password_reset" | "invite" | "otp";

function changed(result: unknown) {
  return Number((result as { affectedRows?: number })?.affectedRows ?? 0);
}

/**
 * Validate and consume an authentication capability exactly once. Purpose,
 * expiry, account status and consumption are checked inside one transaction.
 */
export async function consumeLoginToken(raw: string, kinds: LoginKind[]) {
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  return db.transaction(async (tx) => {
    const [tok] = await tx
      .select()
      .from(loginTokens)
      .where(
        and(
          eq(loginTokens.tokenHash, tokenHash),
          inArray(loginTokens.kind, kinds),
          isNull(loginTokens.consumedAt),
          gt(loginTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!tok) return null;

    const [user] = await tx.select().from(users).where(eq(users.id, tok.userId)).limit(1);
    if (!user || user.status !== "active") return null;

    const [result] = await tx
      .update(loginTokens)
      .set({ consumedAt: new Date() })
      .where(and(eq(loginTokens.id, tok.id), isNull(loginTokens.consumedAt)));
    return changed(result) === 1 ? { token: tok, user } : null;
  });
}
