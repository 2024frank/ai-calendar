import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
await c.query(`CREATE TABLE IF NOT EXISTS user_communities (
  user_id INT NOT NULL,
  community_id INT NOT NULL,
  PRIMARY KEY (user_id, community_id),
  CONSTRAINT fk_uc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_uc_comm FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
)`);
// Seed each user into their home community so memberships are never empty.
await c.query(`INSERT IGNORE INTO user_communities (user_id, community_id)
  SELECT id, community_id FROM users WHERE community_id IS NOT NULL`);
const [rows] = await c.query(`SELECT u.email, c.name FROM user_communities uc
  JOIN users u ON u.id=uc.user_id JOIN communities c ON c.id=uc.community_id ORDER BY u.email`);
console.log("memberships:");
for (const r of rows) console.log(`  ${r.email} -> ${r.name}`);
await c.end();
