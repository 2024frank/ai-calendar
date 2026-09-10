import { timingSafeEqual } from "node:crypto";

/**
 * The worker endpoint accepts a small list of bearer secrets, so each caller
 * (the daily cron, the GitHub tick, a collaborator's scheduler) can hold its
 * own and any one can be revoked without rotating the others. WORKER_SECRET
 * holds them separated by commas; CRON_SECRET stays a fallback for the
 * transition. The first one listed is what this app uses to call itself.
 */
export function workerSecrets(env: Record<string, string | undefined> = process.env): string[] {
  const listed = (env.WORKER_SECRET ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (listed.length) return listed;
  const fallback = env.CRON_SECRET?.trim();
  return fallback ? [fallback] : [];
}

export function ownWorkerSecret(env: Record<string, string | undefined> = process.env): string | null {
  return workerSecrets(env)[0] ?? null;
}

function equalSecrets(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** True when the Authorization header carries any configured worker secret. */
export function authorizedWorkerBearer(
  header: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length);
  if (!presented) return false;
  return workerSecrets(env).some((secret) => equalSecrets(secret, presented));
}
