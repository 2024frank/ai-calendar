import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const ids = process.argv.slice(2).map(Number);
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [r] = await c.query(
  "UPDATE sources SET discovery_status='pending', discovery_error=NULL WHERE id IN (?)",
  [ids]
);
console.log("reset", r.affectedRows, "sources:", ids.join(","));
await c.end();
