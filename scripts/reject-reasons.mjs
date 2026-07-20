import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [rows] = await c.query(`
  SELECT s.name src, e.status, e.rejection_reason, COUNT(*) n
  FROM events e JOIN sources s ON s.id=e.source_id
  GROUP BY s.name, e.status, e.rejection_reason ORDER BY s.name, n DESC`);
for (const r of rows) {
  console.log(`${String(r.src).padEnd(28)} ${String(r.status).padEnd(14)} n=${String(r.n).padEnd(3)} ${String(r.rejection_reason ?? "-").slice(0,90)}`);
}
console.log("\n--- org contacts on file ---");
const [s] = await c.query("SELECT id,name,org_contact_email,org_phone FROM sources WHERE active=1 ORDER BY id");
for (const r of s) console.log(`#${r.id} ${String(r.name).padEnd(28)} email=${r.org_contact_email ?? "MISSING"} phone=${r.org_phone ?? "MISSING"}`);
await c.end();
