import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [r] = await c.query(
  "UPDATE runs SET status='failed', finished_at=NOW(), error_log=JSON_OBJECT('reason','interrupted by a server reload') WHERE status='running'",
);
console.log("orphan runs marked failed:", r.affectedRows);
await c.end();
