import { config } from "dotenv";
import mysql from "mysql2/promise";
import { writeFileSync, mkdirSync } from "fs";

config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });

const ssl = { rejectUnauthorized: false };
const OUT_DIR =
  "/private/tmp/claude-503/-Users-kwaku/d0f64b71-6074-454c-96e3-db9511cdefa2/scratchpad";

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 25060),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl,
    connectTimeout: 15000,
  });

  const [tbls] = await c.query("SHOW TABLES");
  const names = tbls.map((r) => Object.values(r)[0]);
  const dump = {
    database: process.env.DATABASE_NAME,
    takenAt: new Date().toISOString(),
    tables: {},
  };
  for (const t of names) {
    const [[cr]] = await c.query(`SHOW CREATE TABLE \`${t}\``);
    const ddl = cr["Create Table"];
    const [rows] = await c.query(`SELECT * FROM \`${t}\``);
    dump.tables[t] = { ddl, rowCount: rows.length, rows };
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `${OUT_DIR}/oberlin-calendar-backup-${stamp}.json`;
  writeFileSync(
    file,
    JSON.stringify(dump, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  );

  const bytes = JSON.stringify(dump).length;
  console.log(`BACKUP written: ${file}`);
  console.log(`  ${names.length} tables, ~${(bytes / 1024).toFixed(0)} KB`);
  console.log("\nSources preserved (14 expected):");
  for (const s of dump.tables["sources"]?.rows ?? []) {
    console.log(
      `  - ${s.name}  [slug=${s.slug}, type=${s.source_type ?? "?"}, agent=${s.agent_id ? "yes" : "no"}, active=${s.active}]`,
    );
  }
  console.log("\nUsers preserved:");
  for (const u of dump.tables["users"]?.rows ?? []) {
    console.log(`  - ${u.email ?? "?"} [role=${u.role ?? "?"}]`);
  }
  await c.end();
}

main().catch((e) => {
  console.error("BACKUP ERROR:", e.code || "", e.message);
  process.exit(1);
});
