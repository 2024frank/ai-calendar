import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

/**
 * The managed database allows only a small number of concurrent connections.
 * Without caching, every dev hot-reload and every serverless instance opens its
 * own pool and the database starts refusing connections. Keep exactly one pool
 * per process and keep it small.
 */
const globalForDb = globalThis as unknown as { __aiCalendarPool?: mysql.Pool };

function createPool() {
  // Verify the managed-DB certificate when a CA is provided (recommended in
  // production); otherwise fall back to encrypted-but-unverified TLS.
  const ca = process.env.DATABASE_CA_CERT;
  const ssl = ca
    ? { ca: ca.replace(/\\n/g, "\n"), rejectUnauthorized: true }
    : { rejectUnauthorized: false };
  return mysql.createPool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 25060),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 3),
    queueLimit: 0,
    connectTimeout: 15000,
    idleTimeout: 20000,
    enableKeepAlive: true,
  });
}

export const pool = globalForDb.__aiCalendarPool ?? createPool();
globalForDb.__aiCalendarPool = pool;

export const db = drizzle(pool, { schema, mode: "default" });
export { schema };
