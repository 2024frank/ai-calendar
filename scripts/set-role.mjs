import { config } from "dotenv";
import mysql from "mysql2/promise";

config({ path: new URL("../.env.local", import.meta.url) });
const [, , email, role, community] = process.argv;

const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 25060),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
});
const cid = community === "null" || !community ? null : Number(community);
const [res] = await c.query("UPDATE users SET role = ?, community_id = ? WHERE email = ?", [
  role,
  cid,
  email,
]);
console.log(`updated ${res.affectedRows}: ${email} -> ${role} (community ${cid})`);
await c.end();
