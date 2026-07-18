import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const msg = "Blocked by the site's bot protection (HTTP 403) even with a real browser user-agent. This host needs a headless-browser fetch path (JS rendering), which the server-side fetcher does not do yet.";
const [r] = await c.query("UPDATE sources SET discovery_error=? WHERE id IN (4,11,14)", [msg]);
console.log("annotated", r.affectedRows, "blocked sources");
await c.end();
