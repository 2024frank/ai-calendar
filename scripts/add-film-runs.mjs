import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
await c.query(`CREATE TABLE IF NOT EXISTS apollo_film_runs (
  film_key VARCHAR(120) NOT NULL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  opened_on DATE NOT NULL,
  last_seen_on DATE NOT NULL,
  still_showing TINYINT(1) NOT NULL DEFAULT 1,
  ended_on DATE NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`);
console.log("apollo_film_runs ready");
await c.end();
