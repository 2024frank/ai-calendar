import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [[r]] = await c.query("SELECT id FROM runs WHERE source_id=6 AND run_kind='extraction' ORDER BY id DESC LIMIT 1");
const [ev] = await c.query("SELECT kind,label FROM run_events WHERE run_id=? ORDER BY id LIMIT 12",[r.id]);
console.log("run", r.id);
for (const e of ev) console.log(`  ${e.kind}: ${String(e.label).slice(0,110)}`);
const [[rec]] = await c.query("SELECT JSON_EXTRACT(extraction_recipe,'$.canonical_listing_url') u, JSON_EXTRACT(extraction_recipe,'$.endpoint_or_feed_url') f FROM sources WHERE id=6");
console.log("recipe listing:", rec.u, " feed:", rec.f);
await c.end();
