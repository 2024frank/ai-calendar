import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const why = "Not an event source. In the old system this was the Event Correction Agent: it picked up events a reviewer had sent back, applied the requested fixes and resubmitted them. That job is now done by a person directly in the review editor, where every field is editable and rejections train the agent, so this source has nothing to extract.";
const [r] = await c.query("UPDATE sources SET active=0, discovery_status='failed', discovery_error=? WHERE id=3", [why]);
console.log("fixed events corrected, rows:", r.affectedRows);
await c.end();
