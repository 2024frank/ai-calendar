import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
try { await c.query("ALTER TABLE events ADD COLUMN ingested_post_url VARCHAR(2048) NULL"); console.log("added ingested_post_url"); }
catch (e) { console.log("ingested_post_url:", e.code === "ER_DUP_FIELDNAME" ? "already exists" : e.message); }
// Repair links that were written while APP_URL still pointed at localhost.
const app = "https://ai-calendar.uhurued.com";
const [a] = await c.query("UPDATE events SET image_cdn_url = REPLACE(image_cdn_url,'http://localhost:3000',?) WHERE image_cdn_url LIKE 'http://localhost:3000%'", [app]);
console.log("image urls repaired:", a.affectedRows);
// Backfill the reviewer deep link for every existing event.
const [b] = await c.query("UPDATE events SET ingested_post_url = CONCAT(?, '/review/', id) WHERE ingested_post_url IS NULL", [app]);
console.log("deep links backfilled:", b.affectedRows);
await c.end();
