import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [rows] = await c.query(`
  SELECT s.name src, COUNT(*) n, COUNT(DISTINCT e.image_cdn_url) distinct_imgs
  FROM events e JOIN sources s ON s.id=e.source_id
  WHERE e.image_cdn_url IS NOT NULL GROUP BY s.name ORDER BY n DESC`);
for (const r of rows) {
  const generic = r.distinct_imgs === 1 && r.n > 1;
  console.log(`${String(r.src).padEnd(30)} events=${String(r.n).padEnd(3)} distinct images=${r.distinct_imgs} ${generic ? "<-- ALL SAME (generic)" : ""}`);
}
await c.end();
