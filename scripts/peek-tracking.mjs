import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [r] = await c.query("SELECT film_key,title,opened_on,last_seen_on,still_showing,ended_on FROM apollo_film_runs ORDER BY title");
const d = (x) => x ? String(new Date(x).toISOString().slice(0,10)) : "-";
for (const x of r) console.log(`  ${String(x.title).padEnd(26)} opened=${d(x.opened_on)} lastSeen=${d(x.last_seen_on)} showing=${x.still_showing} ended=${d(x.ended_on)}`);
const [ev] = await c.query("SELECT title,description FROM events WHERE source_id=1");
console.log("\n=== announcements ===");
for (const e of ev) console.log(`  ${e.title}\n     ${e.description}`);
await c.end();
