import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";

config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });

const ssl = databaseSsl();

async function main() {
  const app = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 25060),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl,
    connectTimeout: 15000,
  });
  console.log(`CONNECTED as ${process.env.DATABASE_USERNAME} -> ${process.env.DATABASE_NAME}`);

  const [dbs] = await app.query("SHOW DATABASES");
  console.log("DATABASES visible:", dbs.map((r) => Object.values(r)[0]).join(", "));

  const [tables] = await app.query("SHOW TABLES");
  const names = tables.map((r) => Object.values(r)[0]);
  console.log(`\n[${process.env.DATABASE_NAME}] table count: ${names.length}`);
  let totalRows = 0;
  for (const t of names) {
    try {
      const [[c]] = await app.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      totalRows += Number(c.n);
      console.log(`  ${t}: ${c.n} rows`);
    } catch (e) {
      console.log(`  ${t}: (count failed: ${e.code || e.message})`);
    }
  }
  console.log(`TOTAL rows across ${names.length} tables: ${totalRows}`);
  await app.end();

  // Read-only peek at CommunityHub prod-calendar (the destination DB — never written)
  try {
    const ch = await mysql.createConnection({
      host: process.env.CH_DB_HOST,
      port: Number(process.env.CH_DB_PORT || 25060),
      user: process.env.CH_DB_USERNAME,
      password: process.env.CH_DB_PASSWORD,
      database: process.env.CH_DB_NAME,
      ssl,
      connectTimeout: 15000,
    });
    const [ct] = await ch.query("SHOW TABLES");
    console.log(
      `\n[${process.env.CH_DB_NAME}] (read-only) ${ct.length} tables:`,
      ct.map((r) => Object.values(r)[0]).join(", "),
    );
    await ch.end();
  } catch (e) {
    console.log("prod-calendar peek failed:", e.code || e.message);
  }
}

main().catch((e) => {
  console.error("CONNECTION ERROR:", e.code || "", e.message);
  process.exit(1);
});
