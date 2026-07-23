import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: databaseSsl(),
});
const [rows] = await c.query(`SELECT title, location, sponsors, post_type_ids, image_cdn_url img,
  contact_email, phone, sessions, rejection_reason FROM events WHERE source_id=1`);
for (const r of rows) {
  const s = Array.isArray(r.sessions)?r.sessions[0]:null;
  console.log(`- ${r.title}`);
  console.log(`   when: ${s? new Date(s.startTime*1000).toLocaleString("en-US",{timeZone:"America/New_York"}) : "-"}`);
  console.log(`   loc: ${String(r.location).slice(0,50)} | sponsors: ${JSON.stringify(r.sponsors)} | cats: ${JSON.stringify(r.post_type_ids)}`);
  console.log(`   img: ${r.img ?? "(none)"} | ${r.contact_email ?? "-"} ${r.phone ?? "-"}`);
  console.log(`   issue: ${r.rejection_reason ?? "-"}`);
}
await c.end();
