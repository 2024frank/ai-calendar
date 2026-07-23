import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
import { randomBytes, createHash } from "crypto";

config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });

const email = process.argv[2] || "fkusiapp@oberlin.edu";
const raw = randomBytes(32).toString("hex");
const hash = createHash("sha256").update(raw).digest("hex");

const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 25060),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: databaseSsl(),
});

const [[user]] = await c.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
if (!user) {
  console.error("no such user:", email);
  process.exit(1);
}
await c.query(
  "INSERT INTO login_tokens (user_id, kind, token_hash, expires_at) VALUES (?, 'magic', ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))",
  [user.id, hash],
);
console.log(raw);
await c.end();
