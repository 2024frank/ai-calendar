import { parseArgs } from "node:util";
import { databaseSsl } from "./db-ssl.mjs";

function text(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${label} must not contain control characters.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long (maximum ${maxLength}).`);
  return normalized;
}

/**
 * Pure parsing: importing this module never loads credentials or connects.
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 */
export function bootstrapOptions(args = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      "community-slug": { type: "string" },
      "community-name": { type: "string" },
      "admin-email": { type: "string" },
      "admin-name": { type: "string" },
      timezone: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) return { help: true };
  const communitySlug = text(values["community-slug"] ?? env.BOOTSTRAP_COMMUNITY_SLUG, "--community-slug", 80).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(communitySlug)) {
    throw new Error("--community-slug must contain letters, digits and single separating hyphens.");
  }
  const communityName = text(values["community-name"] ?? env.BOOTSTRAP_COMMUNITY_NAME, "--community-name", 200);
  const adminEmail = text(values["admin-email"] ?? env.BOOTSTRAP_ADMIN_EMAIL, "--admin-email", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error("--admin-email must be a valid email address.");
  const rawAdminName = values["admin-name"] ?? env.BOOTSTRAP_ADMIN_NAME;
  const adminName = rawAdminName ? text(rawAdminName, "--admin-name", 200) : null;
  const timezone = text(values.timezone ?? env.BOOTSTRAP_TIMEZONE ?? "UTC", "--timezone", 64);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error("--timezone must be a valid IANA timezone.");
  }
  return { help: false, communitySlug, communityName, adminEmail, adminName, timezone };
}

/** @param {Record<string, string | undefined>} env */
export function bootstrapDatabaseOptions(env = process.env) {
  const host = text(env.DATABASE_HOST, "DATABASE_HOST", 253);
  const user = text(env.DATABASE_USERNAME, "DATABASE_USERNAME", 128);
  const database = text(env.DATABASE_NAME, "DATABASE_NAME", 64);
  if (!env.DATABASE_PASSWORD) throw new Error("DATABASE_PASSWORD is required.");
  const port = Number(env.DATABASE_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DATABASE_PORT must explicitly specify a port from 1 to 65535.");
  }
  return {
    host, port, user, password: env.DATABASE_PASSWORD, database,
    ssl: databaseSsl(env), connectTimeout: 15000, multipleStatements: false,
  };
}
