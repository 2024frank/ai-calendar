/** Names only: callers may report these safely without leaking secret values. */
export function productionConfigIssues(env: NodeJS.ProcessEnv = process.env): string[] {
  const issues: string[] = [];
  const required = [
    "DATABASE_HOST",
    "DATABASE_USERNAME",
    "DATABASE_PASSWORD",
    "DATABASE_NAME",
    "PERPLEXITY_API_KEY",
    "AUTH_JWT_SECRET",
    "AGENT_INGEST_SECRET",
    "CRON_SECRET",
    "APP_URL",
  ] as const;

  for (const name of required) {
    if (!env[name]?.trim()) issues.push(`${name} is missing`);
  }
  for (const name of ["AUTH_JWT_SECRET", "AGENT_INGEST_SECRET", "CRON_SECRET"] as const) {
    const value = env[name];
    if (value && value.length < 32) issues.push(`${name} must be at least 32 characters`);
  }

  if (env.APP_URL) {
    try {
      const url = new URL(env.APP_URL);
      if (env.NODE_ENV === "production" && url.protocol !== "https:") {
        issues.push("APP_URL must use HTTPS in production");
      }
    } catch {
      issues.push("APP_URL is not a valid URL");
    }
  }
  return issues;
}
