import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [rows] = await c.query("SELECT id,name,legacy_agent_id, CHAR_LENGTH(COALESCE(special_instructions,'')) len, LEFT(COALESCE(special_instructions,''),90) head FROM sources ORDER BY id");
for (const r of rows) {
  console.log(`#${r.id} ${r.name}`);
  console.log(`   legacy_agent: ${r.legacy_agent_id ?? "(none)"}  instr_len=${r.len}`);
  console.log(`   instr_head: ${String(r.head).replace(/\n/g," ").slice(0,88)}`);
}
await c.end();
