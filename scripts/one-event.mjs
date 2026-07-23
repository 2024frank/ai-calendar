import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: databaseSsl(),
});
const [rows] = await c.query("SELECT id, title, image_cdn_url IS NOT NULL AS has_img FROM events WHERE status='pending' ORDER BY (image_cdn_url IS NOT NULL) DESC, id LIMIT 3");
for (const r of rows) console.log(`${r.id}\t${r.has_img?'IMG':'no '}\t${r.title}`);
await c.end();
