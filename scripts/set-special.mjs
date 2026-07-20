import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const fava = `FAVA has two kinds of content, handled differently:
1. Classes, camps, workshops and drop-ins (favagallery.org/classes) are ANNOUNCEMENTS. Title them with their FAVA label: "Camp: <name>", "Class: <name>", "Workshop: <name>", "Drop-in: <name>". The session is the registration window, not the meeting dates; put the real meeting dates, session count, instructor, member and non-member price, and age or materials rules in the long description.
2. Exhibitions (exhibitions.favagallery.org) are one ANNOUNCEMENT for the whole run. If a show has an artist talk with a specific future date and time, add a SEPARATE EVENT titled "Artist Talk: <show name>" and fold the opening reception into that talk's description. A show with no talk is just the one announcement.
Skip an item when it is private (a private lesson or "Private Pottery Pop-In"), full or closed (sold out, waitlist only, registration closed), already started, or year-round with no specific upcoming start.`;

const oberlin = `This is the Oberlin College Localist calendar API. Its link already carries the exclude_type filters; keep them.
Audience: keep an event only when it is open to the general public, that is filters.event_public_events contains "Open to all members of the public". Skip anything open only to students, staff, faculty, alumni, or the campus community, and skip anything where private is true.
Each event_instance is its own occurrence: make one record per instance with that instance's times, not one record covering all of them.
Field mapping: photo_url is the image; geo gives the street address; filters.departments names the sponsors (fall back to "Oberlin College"); custom_fields has the contact email and phone; the event url is the website and the per-event source link.`;

const byName = { "FAVA": fava, "Oberlin College": oberlin };
for (const [name, text] of Object.entries(byName)) {
  const [r] = await c.query("UPDATE sources SET special_instructions=? WHERE name=?", [text, name]);
  console.log(`${name}: ${r.affectedRows ? "set" : "NO ROW (source not present)"}`);
}
await c.end();
