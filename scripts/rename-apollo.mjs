import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [a] = await c.query("UPDATE events SET title='Playing at the Apollo' WHERE title='Now Playing at the Apollo'");
const [b] = await c.query("UPDATE events SET title='Coming Soon at the Apollo' WHERE title='Coming Soon to the Apollo'");
console.log(`renamed: now-playing=${a.affectedRows} coming-soon=${b.affectedRows}`);
const [rows] = await c.query("SELECT title FROM events WHERE source_id=1");
for (const r of rows) console.log("  ->", r.title);
await c.end();
