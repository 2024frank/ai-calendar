import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [rows] = await c.query("SELECT id,source_id,run_kind,status,events_found,events_extracted,started_at,finished_at FROM runs ORDER BY id DESC LIMIT 5");
for (const r of rows) console.log(`run ${r.id} src=${r.source_id} ${r.run_kind} ${r.status} found=${r.events_found} ins=${r.events_extracted}`);
const [ev] = await c.query("SELECT kind,label FROM run_events WHERE run_id=(SELECT MAX(id) FROM runs) ORDER BY id DESC LIMIT 3");
for (const e of ev) console.log(`  last: ${e.kind}: ${String(e.label).slice(0,100)}`);
await c.end();
