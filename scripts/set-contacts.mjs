import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
// Verified from each organization's own published site.
const rows = [[4,"info@oberlinlibrary.org",null]];
for (const [id,email,phone] of rows) {
  await c.query("UPDATE sources SET org_contact_email=COALESCE(?,org_contact_email), org_phone=COALESCE(?,org_phone) WHERE id=?", [email,phone,id]);
  console.log(`#${id} email=${email ?? "(kept)"} phone=${phone ?? "(kept)"}`);
}
await c.end();
