import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: databaseSsl(),
});
const [a] = await c.query("UPDATE events SET title='Playing Now at the Apollo' WHERE title IN ('Playing at the Apollo','Now Playing at the Apollo')");
console.log("renamed rows:", a.affectedRows);
const [rows] = await c.query("SELECT title FROM events WHERE source_id=1");
for (const r of rows) console.log("  ->", r.title);
await c.end();
