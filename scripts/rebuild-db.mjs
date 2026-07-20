import { config } from "dotenv";
import mysql from "mysql2/promise";
import { readFileSync } from "fs";

config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });

const ssl = { rejectUnauthorized: false };
const DB = process.env.DATABASE_NAME;

// Hard safety guard: this script may ONLY ever run against the app DB.
if (DB !== "oberlin-calendar") {
  console.error(`SAFETY ABORT: expected DATABASE_NAME=oberlin-calendar, got '${DB}'`);
  process.exit(1);
}

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 25060),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: DB,
    ssl,
    connectTimeout: 15000,
  });

  // Second guard: confirm the live connection is on the expected database.
  const [[dbrow]] = await c.query("SELECT DATABASE() AS db");
  if (dbrow.db !== "oberlin-calendar") {
    console.error("SAFETY ABORT: connected database is", dbrow.db);
    process.exit(1);
  }

  // 1) Drop every existing table (backup already taken).
  await c.query("SET FOREIGN_KEY_CHECKS=0");
  const [tbls] = await c.query("SHOW TABLES");
  const existing = tbls.map((r) => Object.values(r)[0]);
  console.log(`Dropping ${existing.length} existing tables in ${DB}...`);
  for (const t of existing) await c.query(`DROP TABLE IF EXISTS \`${t}\``);
  await c.query("SET FOREIGN_KEY_CHECKS=1");

  // 2) Apply the generated schema.
  const sqlText = readFileSync(new URL("../drizzle/0000_init.sql", import.meta.url), "utf8");
  const stmts = sqlText
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`Applying ${stmts.length} DDL statements...`);
  for (const s of stmts) await c.query(s);

  // 3) Verify.
  const [after] = await c.query("SHOW TABLES");
  const names = after.map((r) => Object.values(r)[0]);
  console.log(`\nDone. ${DB} now has ${names.length} tables:`);
  console.log("  " + names.join(", "));
  await c.end();
}

main().catch((e) => {
  console.error("REBUILD ERROR:", e.code || "", e.sqlMessage || e.message);
  process.exit(1);
});
