import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
// Keep only the newest announcement per title for Apollo.
const [r] = await c.query(`
  DELETE e FROM events e
  JOIN (SELECT title, MAX(id) keep FROM events WHERE source_id=1 GROUP BY title) k
    ON e.title = k.title AND e.id < k.keep
  WHERE e.source_id = 1`);
console.log("removed superseded apollo events:", r.affectedRows);
const [rows] = await c.query("SELECT id,title,description,status FROM events WHERE source_id=1 ORDER BY id");
for (const x of rows) console.log(`  #${x.id} [${x.status}] ${x.title}\n     ${x.description}`);
await c.end();
