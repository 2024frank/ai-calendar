import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [rows] = await c.query("SELECT title, website, calendar_source_url, calendar_source_name FROM events WHERE status='pending' LIMIT 5");
for (const r of rows) console.log(`- ${String(r.title).slice(0,34)}\n    website: ${r.website}\n    src url: ${r.calendar_source_url}`);
await c.end();
