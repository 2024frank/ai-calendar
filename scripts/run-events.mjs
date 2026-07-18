import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const id = Number(process.argv[2]);
const [ev] = await c.query("SELECT kind,label FROM run_events WHERE run_id=? ORDER BY id",[id]);
for (const e of ev) console.log(`  ${e.kind}: ${String(e.label).slice(0,140)}`);
await c.end();
