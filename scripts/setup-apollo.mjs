import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
// wipe
for (const q of ["DELETE FROM publish_submissions","DELETE FROM events","DELETE FROM run_events","DELETE FROM runs","DELETE FROM apollo_film_runs","DELETE FROM sources"]) {
  try { await c.query(q); } catch { /* table may not exist */ }
}
const url = "https://ticketing.uswest.veezi.com/sessions/?siteToken=qag5g529fjpr8w719hbz5dgwcg";
const special = `Apollo Theatre, 19 East College Street, Oberlin OH, operated by Cleveland Cinemas. The first link is the Veezi ticketing page: a rolling ~12-day window of films and their dates, no pagination. Fetch it and read every film and every date it shows.

STEP 1 - date range per film
For each film, collect every date it appears. Its run is continuous from the earliest to the latest date shown: startDate = earliest, endDate = latest. (The page is a rolling window, so endDate is the last visible date, not necessarily the true final day.)

STEP 2 - classify against today
- Playing Now  : startDate <= today AND endDate >= today
- Coming Soon  : startDate > today
- Already Ended: endDate < today -> skip entirely

STEP 3A - "Playing Now at the Apollo" announcements
Use only Playing Now films. Make one announcement per window where the lineup changes:
1. Take every unique endDate of the Playing Now films, sorted ascending.
2. Window 1 = today to the first endDate. Window 2 = the day after to the second endDate. And so on.
3. A film belongs in a window [start,end] if startDate <= start AND endDate >= end.
4. In the short description list each film as "Title: start to stop" using its OWN real dates. Join films with " . ".
Worked example. Today = Jun 8. Wicked May 30 to Jun 9, Nosferatu Jun 4 to Jun 12. Sorted endDates [Jun 9, Jun 12].
  Jun 8 to Jun 9  -> "Wicked: May 30 to Jun 9 . Nosferatu: Jun 4 to Jun 12"
  Jun 10 to Jun 12 -> "Nosferatu: Jun 4 to Jun 12"

STEP 3B - "Coming Soon at the Apollo" announcements
Use only Coming Soon films. If none, skip this section.
1. Take every unique startDate, sorted ascending.
2. Window 1 = today to the day before the first startDate. Window 2 = the first startDate to the day before the second. And so on.
3. A film belongs if it has NOT opened by the window's end.
4. Describe each film as "Title: opens <date>". Join with " . ".
Worked example. Today = Jun 8. Dragon opens Jun 13, Inside Out 2 opens Jun 21.
  Jun 8 to Jun 12  -> "How to Train Your Dragon: opens Jun 13 . Inside Out 2: opens Jun 21"
  Jun 13 to Jun 20 -> "Inside Out 2: opens Jun 21"

For each announcement:
- eventType "an", category Film (5), sponsor "Apollo Theater".
- sessions: start = the window's first day at 00:00, end = the window's last day at 23:59, as ISO wall-clock strings.
- locationType "ph2", location "19 East College Street, Oberlin, OH 44074", placeName "Apollo Theatre".
- contactEmail apollo@clevelandcinemas.com, phone 440-774-3920, website https://www.clevelandcinemas.com/our-locations/x03gq-apollo-theatre/.
- buttons: a "Buy Tickets" button linking to the Veezi page (the first link).
- imageCdnUrl: search the web for the official movie poster of the FIRST film in that window (prefer image.tmdb.org or m.media-amazon.com) and use it. Each announcement gets a real poster image, never a logo.
- Never announce a film that only plays today, and never invent an end date for a film still on sale at the edge of the visible window.`;

const [r] = await c.query(
  `INSERT INTO sources (community_id,name,slug,source_type,url,start_urls,special_instructions,discovery_status,active,
     org_name,org_website,org_phone,org_contact_email,calendar_source_name,schedule_cron)
   VALUES (1,'Apollo Theater','apollo-theater','web',?,?,?,'pending',1,
     'Apollo Theater','https://www.clevelandcinemas.com/our-locations/x03gq-apollo-theatre/','440-774-3920','apollo@clevelandcinemas.com','Apollo Theatre','0 6 * * *')`,
  [url, JSON.stringify([url]), special],
);
console.log("Apollo source id:", r.insertId);
await c.end();
