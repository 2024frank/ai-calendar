import { config } from "dotenv";
import type { Config } from "drizzle-kit";

config({ path: ".env.local" });

function databaseSsl() {
  const host = process.env.DATABASE_HOST?.trim().toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const disabled = process.env.DATABASE_SSL?.trim().toLowerCase() === "false";
  const ca = process.env.DATABASE_CA_CERT?.trim();

  if (disabled) {
    if (!loopback) {
      throw new Error("DATABASE_SSL=false is allowed only for a loopback database");
    }
    return undefined;
  }
  if (ca) return { ca: ca.replace(/\\n/g, "\n"), rejectUnauthorized: true };
  if (loopback) return undefined;
  return { rejectUnauthorized: true };
}

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    host: process.env.DATABASE_HOST!,
    port: Number(process.env.DATABASE_PORT || 25060),
    user: process.env.DATABASE_USERNAME!,
    password: process.env.DATABASE_PASSWORD!,
    database: process.env.DATABASE_NAME!,
    ssl: databaseSsl(),
  },
} satisfies Config;
