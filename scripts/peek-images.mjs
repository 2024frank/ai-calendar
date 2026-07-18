import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [rows] = await c.query(`
  SELECT s.name src, e.title, e.image_cdn_url img, e.website, e.url_link
  FROM events e JOIN sources s ON s.id=e.source_id
  WHERE s.name LIKE '%FAVA%' LIMIT 8`);
for (const r of rows) {
  console.log(`[${r.src}] ${String(r.title).slice(0,40)}`);
  console.log(`   img: ${r.img}`);
  console.log(`   web: ${r.website ?? '-'}`);
}
console.log("\n=== distinct image hosts across all events ===");
const [hosts] = await c.query("SELECT image_cdn_url FROM events WHERE image_cdn_url IS NOT NULL");
const tally = {};
for (const h of hosts) { try { const u=new URL(h.image_cdn_url); const k=u.hostname+ (u.pathname.match(/screenshot|thumb|placeholder|logo/i)?" [SUSPECT]":""); tally[k]=(tally[k]||0)+1; } catch{} }
for (const [k,v] of Object.entries(tally).sort((a,b)=>b[1]-a[1])) console.log(`  ${v}x ${k}`);
await c.end();
