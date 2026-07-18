import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [rows] = await c.query(`
  SELECT e.title, e.image_cdn_url img, e.contact_email, e.phone, e.website, e.rejection_reason
  FROM events e JOIN sources s ON s.id=e.source_id WHERE s.id=6 LIMIT 6`);
for (const r of rows) {
  console.log(`- ${String(r.title).slice(0,44)}`);
  console.log(`    img:   ${r.img ?? "(none)"}`);
  console.log(`    email: ${r.contact_email ?? "-"}  phone: ${r.phone ?? "-"}`);
  console.log(`    issue: ${r.rejection_reason ?? "-"}`);
}
const [[agg]] = await c.query("SELECT COUNT(*) n, COUNT(DISTINCT image_cdn_url) distinct_imgs, SUM(image_cdn_url IS NULL) no_img FROM events WHERE source_id=6");
console.log(`\nFAVA: ${agg.n} events, ${agg.distinct_imgs} distinct images, ${agg.no_img} without image`);
await c.end();
