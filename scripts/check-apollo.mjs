import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [rows] = await c.query("SELECT id,title,image_cdn_url,ingested_post_url,LENGTH(image_data) img_bytes FROM events WHERE source_id=1");
for (const r of rows) {
  console.log(`#${r.id} ${r.title}`);
  console.log(`   image:     ${r.image_cdn_url}`);
  console.log(`   deep link: ${r.ingested_post_url}`);
  console.log(`   merged jpg base64 bytes: ${r.img_bytes ?? 0}`);
}
await c.end();
