import { config } from "dotenv";
import mysql from "mysql2/promise";

config({ path: new URL("../.env.local", import.meta.url) });

const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 25060),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
});

const [rej] = await c.query(
  "SELECT r.id, r.reason_code, r.note, s.name AS source FROM rejection_log r LEFT JOIN sources s ON s.id=r.source_id ORDER BY r.id DESC LIMIT 10",
);
const [edits] = await c.query(
  "SELECT f.id, f.field_name, f.old_value, f.new_value, s.name AS source FROM field_edit_log f LEFT JOIN sources s ON s.id=f.source_id ORDER BY f.id DESC LIMIT 10",
);
const [rules] = await c.query("SELECT * FROM source_rules ORDER BY id DESC LIMIT 10");
const [statuses] = await c.query(
  "SELECT status, COUNT(*) n FROM events GROUP BY status ORDER BY n DESC",
);

console.log("EVENT STATUSES:");
for (const s of statuses) console.log(`  ${s.status}: ${s.n}`);

console.log("\nREJECTIONS (feed the next run):");
for (const r of rej) console.log(`  [${r.source}] ${r.reason_code} — ${r.note ?? ""}`);

console.log("\nFIELD CORRECTIONS (feed the next run):");
for (const e of edits)
  console.log(`  [${e.source}] ${e.field_name}: "${(e.old_value ?? "").slice(0, 30)}" -> "${(e.new_value ?? "").slice(0, 40)}"`);

console.log(`\nPROMOTED RULES: ${rules.length}`);
for (const r of rules)
  console.log(`  ${r.field_name} = "${r.preferred_value}" (support ${r.support_count})`);

await c.end();
