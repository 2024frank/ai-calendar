import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const specials = [
  [1, "Apollo Theater uses the Veezi ticketing API (APOLLO_VEEZI_SITE_TOKEN). Showtimes are not on a scrapeable public page; this needs a dedicated Veezi connector, not the generic web agent."],
  [3, "Fixed Events are recurring/manually-defined with no public listing page to probe. Add these events directly, or give the source a real calendar URL."],
  [7, "Email (IMAP) source: it needs a mailbox connection, not a URL. No inbox is configured for it yet."],
];
for (const [id, why] of specials) {
  await c.query(
    "UPDATE sources SET active=0, discovery_status='failed', discovery_error=? WHERE id=?",
    [why, id]
  );
  console.log(`#${id} paused: ${why.slice(0,60)}...`);
}
// OBP has a real URL but was off; turn it on so it runs with the rest.
await c.query("UPDATE sources SET active=1, discovery_status='pending' WHERE id=14");
console.log("#14 Oberlin Business Partnership re-enabled");
await c.end();
