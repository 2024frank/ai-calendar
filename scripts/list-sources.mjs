import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [rows] = await c.query(
  "SELECT id, name, source_type, active, discovery_status, url FROM sources ORDER BY id"
);
for (const r of rows) {
  console.log(
    `#${String(r.id).padStart(2)} ${r.active ? "on " : "off"} ${String(r.discovery_status).padEnd(11)} ${String(r.source_type).padEnd(5)} ${r.name}`
  );
  console.log(`      url: ${r.url ?? "(none)"}`);
}
await c.end();
