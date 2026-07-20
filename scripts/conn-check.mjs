import { config } from "dotenv";
import mysql from "mysql2/promise";

config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });

const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 25060),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
});

const [[mx]] = await c.query("SHOW VARIABLES LIKE 'max_connections'");
const [[th]] = await c.query("SHOW STATUS LIKE 'Threads_connected'");
console.log(`max_connections    = ${mx.Value}`);
console.log(`threads_connected  = ${th.Value}`);
await c.end();
