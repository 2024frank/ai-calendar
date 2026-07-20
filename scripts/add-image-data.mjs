import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
try {
  await c.query("ALTER TABLE events ADD COLUMN image_data MEDIUMTEXT NULL");
  console.log("added image_data (MEDIUMTEXT)");
} catch (e) {
  console.log("image_data:", e.code === "ER_DUP_FIELDNAME" ? "already exists" : e.message);
}
await c.end();
