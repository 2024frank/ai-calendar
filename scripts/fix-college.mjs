import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: new URL("../.env.local", import.meta.url) });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const instructions = `This is the Oberlin College Localist calendar API. Each event object has a "filters" object.

AUDIENCE RULE (most important, apply before anything else):
- Look at filters.event_public_events for each event.
- KEEP an event only if it is open to the general public, that is filters.event_public_events contains "Open to all members of the public".
- SKIP the event entirely if its event_public_events lists only campus audiences and does NOT include the public one. Those values look like "Open to all Oberlin students", "Open to all Oberlin staff", "Open to all Oberlin faculty", "Open to all members of the Oberlin campus community", "Open to Oberlin alumni". These are internal campus events and must not be returned.
- If an event has no event_public_events entry at all, keep it only when the event is clearly open to the townspeople (for example a public concert, exhibit, or lecture). When in doubt about a campus-only event, skip it.

OTHER NOTES:
- Use photo_url for imageCdnUrl when present, it is that event's own picture.
- Use location_name plus address for the location; if both are empty, use "Oberlin College, Oberlin, OH".
- Use the event's own url or localist_url as the website.
- Times in event_instances are already local Oberlin time.`;
const [r] = await c.query("UPDATE sources SET special_instructions=? WHERE id=2", [instructions]);
console.log("oberlin college instructions set, rows:", r.affectedRows);
await c.end();
