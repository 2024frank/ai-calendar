import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [rows] = await c.query("SELECT id,community_id,name,type,active,config FROM destinations");
for (const r of rows) {
  console.log(`#${r.id} community=${r.community_id} ${r.name} type=${r.type} active=${r.active}`);
  const cfg = typeof r.config === "string" ? JSON.parse(r.config) : r.config;
  for (const [k,v] of Object.entries(cfg ?? {})) {
    console.log(`    ${k}: ${typeof v === "object" ? JSON.stringify(v).slice(0,80) : String(v).slice(0,90)}`);
  }
}
const [[c2]] = await c.query("SELECT default_destination_id FROM communities WHERE id=1");
console.log("oberlin default_destination_id:", c2.default_destination_id);
await c.end();
