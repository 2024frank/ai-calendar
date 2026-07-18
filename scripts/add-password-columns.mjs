import { config } from "dotenv";
import mysql from "mysql2/promise";

config({ path: new URL("../.env.local", import.meta.url) });

const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 25060),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
});

async function hasColumn(table, column) {
  const [rows] = await c.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ? AND column_name = ? LIMIT 1`,
    [process.env.DATABASE_NAME, table, column],
  );
  return rows.length > 0;
}

if (!(await hasColumn("users", "password_hash"))) {
  await c.query("ALTER TABLE `users` ADD COLUMN `password_hash` varchar(255) NULL");
  console.log("added users.password_hash");
} else console.log("users.password_hash already present");

if (!(await hasColumn("users", "must_set_password"))) {
  await c.query(
    "ALTER TABLE `users` ADD COLUMN `must_set_password` boolean NOT NULL DEFAULT true",
  );
  console.log("added users.must_set_password");
} else console.log("users.must_set_password already present");

await c.end();
