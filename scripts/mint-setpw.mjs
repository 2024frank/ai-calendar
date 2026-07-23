import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
import { randomBytes, createHash } from "crypto";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const email = process.argv[2] || "fkusiapp@oberlin.edu";
const base = process.argv[3] || "https://ai-calendar.uhurued.com";
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: databaseSsl(),
});
const [[u]] = await c.query("SELECT id FROM users WHERE email=? LIMIT 1",[email]);
if(!u){ console.error("no user",email); process.exit(1);}
const raw = randomBytes(32).toString("hex");
await c.query(
  "INSERT INTO login_tokens (user_id, kind, token_hash, expires_at) VALUES (?, 'otp', ?, DATE_ADD(NOW(), INTERVAL 7 DAY))",
  [u.id, createHash("sha256").update(raw).digest("hex")]
);
console.log(`${base}/set-password?token=${raw}`);
await c.end();
