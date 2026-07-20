import { config } from "dotenv"; import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({ host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060), user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false } });
for (const e of process.argv.slice(2)) { const [r] = await c.query("DELETE FROM users WHERE email = ?", [e]); console.log("deleted", e, r.affectedRows); }
await c.end();
