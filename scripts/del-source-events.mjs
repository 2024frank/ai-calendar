import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const ids = process.argv.slice(2).map(Number);
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [r] = await c.query("DELETE FROM events WHERE source_id IN (?)", [ids]);
console.log(`deleted ${r.affectedRows} events for sources ${ids.join(",")}`);
await c.end();
