import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: databaseSsl(),
});
const cols = [
  ["place_name", "VARCHAR(200)"],
  ["room_num", "VARCHAR(120)"],
  ["geo_scope", "VARCHAR(20)"],
];
for (const [name, type] of cols) {
  try {
    await c.query(`ALTER TABLE events ADD COLUMN ${name} ${type} NULL`);
    console.log("added", name);
  } catch (e) {
    console.log(name, e.code === "ER_DUP_FIELDNAME" ? "already exists" : e.message);
  }
}
await c.end();
