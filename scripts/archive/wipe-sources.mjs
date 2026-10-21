import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: databaseSsl(),
});
const before = {};
for (const t of ["events","runs","sources","apollo_film_runs","publish_submissions","learned_rules","reviewer_sources"]) {
  try { const [[r]] = await c.query(`SELECT COUNT(*) n FROM \`${t}\``); before[t] = r.n; } catch { before[t] = "-"; }
}
console.log("before:", JSON.stringify(before));
// Children first so foreign keys stay satisfied.
for (const q of [
  "DELETE FROM publish_submissions",
  "DELETE FROM events",
  "DELETE FROM run_events",
  "DELETE FROM runs",
  "DELETE FROM learned_rules",
  "DELETE FROM reviewer_sources",
  "DELETE FROM apollo_film_runs",
  "DELETE FROM sources",
]) { try { await c.query(q); } catch (e) { console.log(" skip:", q, e.code); } }
const [[s]] = await c.query("SELECT COUNT(*) n FROM sources");
const [[e]] = await c.query("SELECT COUNT(*) n FROM events");
console.log(`after: sources=${s.n} events=${e.n}`);
await c.end();
