import { config } from "dotenv";
import mysql from "mysql2/promise";

config({ path: new URL("../.env.local", import.meta.url) });

const [, , slug, url] = process.argv;
if (!slug || !url) {
  console.error("usage: node scripts/set-source-url.mjs <slug> <url>");
  process.exit(1);
}

const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 25060),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
});

const [res] = await c.query(
  "UPDATE sources SET url = ?, start_urls = ?, discovery_status = 'pending' WHERE slug = ?",
  [url, JSON.stringify([url]), slug],
);
const [[row]] = await c.query(
  "SELECT id, name, slug, url, discovery_status FROM sources WHERE slug = ?",
  [slug],
);
console.log("updated rows:", res.affectedRows);
console.log(row);
await c.end();
