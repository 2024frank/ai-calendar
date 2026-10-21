import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
import { SignJWT } from "jose";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const email = process.argv[2] || "fkusiapp@oberlin.edu";
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: databaseSsl(),
});
const [[u]] = await c.query("SELECT id,email,name,role,community_id,can_review_all_sources FROM users WHERE email=? LIMIT 1",[email]);
await c.end();
if (!u) { console.error("no user", email); process.exit(1); }
const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET);
const token = await new SignJWT({
  uid: u.id, email: u.email, name: u.name ?? null, role: u.role,
  communityId: u.community_id ?? null, canReviewAllSources: !!u.can_review_all_sources,
}).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret);
console.error(`user #${u.id} ${u.email} role=${u.role} community=${u.community_id}`);
console.log(token);
