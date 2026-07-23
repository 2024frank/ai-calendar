import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: databaseSsl(),
});
const [r] = await c.query("SELECT id, rejection_reason FROM events WHERE rejection_reason IS NOT NULL AND status='pending' LIMIT 1");
if (r[0]) console.log(`${r[0].id}\t${r[0].rejection_reason}`);
await c.end();
