import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [rows] = await c.query("SELECT id,email,role,status,password_hash IS NOT NULL AS has_pw, must_set_password FROM users ORDER BY id");
for (const r of rows) console.log(`#${r.id} ${r.email} role=${r.role} status=${r.status} hasPassword=${!!r.has_pw} mustSetPassword=${!!r.must_set_password}`);
await c.end();
