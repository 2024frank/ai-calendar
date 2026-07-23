import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: databaseSsl(),
});
const [rows] = await c.query("SELECT id,title,sessions,sponsors FROM events WHERE status='pending'");
let moved = 0;
for (const r of rows) {
  const sessions = Array.isArray(r.sessions) ? r.sessions : [];
  const sponsors = Array.isArray(r.sponsors) ? r.sponsors : [];
  const hasSession = sessions.some((s) => Number(s?.startTime) > 0);
  const hard = [];
  if (!r.title || !String(r.title).trim()) hard.push("title_missing");
  if (!hasSession) hard.push("sessions_missing");
  if (!sponsors.filter(Boolean).length) hard.push("sponsors_missing");
  if (hard.length) {
    await c.query(
      "UPDATE events SET status='auto_rejected', rejection_reason=? WHERE id=?",
      [`Auto-rejected (incomplete): ${hard.join(", ")}`, r.id]
    );
    moved++;
  }
}
const [[after]] = await c.query("SELECT SUM(status='pending') pending, SUM(status='auto_rejected') autorej, SUM(status='duplicate') dup, COUNT(*) total FROM events");
console.log(`moved ${moved} incomplete -> auto_rejected`);
console.log(`now: pending=${after.pending} auto_rejected=${after.autorej} duplicate=${after.dup} total=${after.total}`);
await c.end();
