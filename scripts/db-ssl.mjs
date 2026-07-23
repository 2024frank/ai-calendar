function isLoopbackHost(host) {
  const normalized = String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

/**
 * Keep maintenance scripts on the same certificate-verification policy as the
 * application. A local database may explicitly disable TLS; remote databases
 * may not silently opt out of server authentication.
 */
export function databaseSsl(env = process.env) {
  const host = env.DATABASE_HOST;
  const disabled = env.DATABASE_SSL?.trim().toLowerCase() === "false";
  const ca = env.DATABASE_CA_CERT?.trim();

  if (disabled) {
    if (!isLoopbackHost(host)) {
      throw new Error("DATABASE_SSL=false is allowed only for a loopback database");
    }
    return undefined;
  }

  if (ca) {
    return { ca: ca.replace(/\\n/g, "\n"), rejectUnauthorized: true };
  }

  if (isLoopbackHost(host)) return undefined;
  return { rejectUnauthorized: true };
}
