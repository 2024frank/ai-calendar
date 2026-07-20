import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({ host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060), user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false } });
const [rows] = await c.query("SELECT title,description,sessions,buttons,contact_email,phone,image_cdn_url FROM events WHERE source_id=18 ORDER BY id");
for (const x of rows) {
  const s = (typeof x.sessions === "string" ? JSON.parse(x.sessions) : x.sessions) || [];
  const b = (typeof x.buttons === "string" ? JSON.parse(x.buttons||"null") : x.buttons);
  console.log(`- ${x.title}`);
  console.log(`   desc: ${x.description}`);
  console.log(`   when: ${s[0] ? new Date(s[0].startTime*1000).toISOString().slice(0,10)+" to "+new Date(s[0].endTime*1000).toISOString().slice(0,10) : "none"}`);
  console.log(`   button: ${b ? JSON.stringify(b) : "none"} | ${x.contact_email} ${x.phone}`);
  console.log(`   image: ${x.image_cdn_url ? String(x.image_cdn_url).slice(0,70) : "none"}`);
}
await c.end();
