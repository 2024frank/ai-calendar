import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({ host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060), user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME, ssl: databaseSsl() });
const special = `Apollo Theatre, 19 East College Street, Oberlin OH, operated by Cleveland Cinemas. The first link is the Veezi ticketing page: a rolling window of about 12 days, no pagination. Read the WHOLE page.

CONSOLIDATE FIRST. The same film appears on the page once for every date it plays. Group them: each film becomes ONE entry with startDate = its earliest date shown and endDate = its latest date shown. Include EVERY distinct film on the page. There are usually four to eight films; do not stop after the first few.

Classify each film against today:
- endDate is today or earlier -> Already Ended, skip it.
- startDate is today or tomorrow onward -> it is on sale.

Make TWO kinds of announcement.

A) "Playing Now at the Apollo" - the films on sale, looking forward from tomorrow.
Segment into windows where the LINEUP changes. A new window starts whenever a film ends and whenever a new film opens. In each window list every film showing across it, as "Title: startDate to endDate" using each film's OWN real dates. Join films with " . ". Give this announcement an imageUrls list with one movie poster per film in the window (search the web for each official poster, prefer image.tmdb.org or m.media-amazon.com); the server merges them into one picture.

B) "Coming Soon at the Apollo" - films that have NOT opened yet (their startDate is later than the first Playing Now window). One announcement per opening date, each film as "Title: opens startDate". Give imageUrls with a poster per film here too.

WORKED EXAMPLE using a page like today's (today = Jul 20):
Films after consolidating: Moana Jul 21-23, The Odyssey Jul 21-29, Young Washington Jul 24-30, Spider-Man Jul 30.
- Playing Now window Jul 21 to Jul 23: Moana and The Odyssey both show -> "Moana: Jul 21 to Jul 23 . The Odyssey: Jul 21 to Jul 29", imageUrls = [Moana poster, Odyssey poster].
- Playing Now window Jul 24 to Jul 30: The Odyssey and Young Washington show -> "The Odyssey: Jul 21 to Jul 29 . Young Washington: Jul 24 to Jul 30", imageUrls = [Odyssey poster, Young Washington poster].
- Coming Soon: "Spider-Man: Brand New Day: opens Jul 30", imageUrls = [Spider-Man poster]. (Young Washington is already covered in Playing Now once it opens, so it is not repeated in Coming Soon.)

Every announcement: eventType "an", category Film (5), sponsor "Apollo Theater", locationType "ph2", location "19 East College Street, Oberlin, OH 44074", placeName "Apollo Theatre". sessions: start = the window's first day 00:00, end = the window's last day 23:59, as ISO wall-clock strings. contactEmail apollo@clevelandcinemas.com, phone 440-774-3920, website https://www.clevelandcinemas.com/our-locations/x03gq-apollo-theatre/. Add a "Buy Tickets" button linking to the first link. Never invent an end date for a film still on sale at the very edge of the visible window; use its last visible date.`;
const [r] = await c.query("UPDATE sources SET special_instructions=? WHERE id=18", [special]);
console.log("apollo instructions updated, rows:", r.affectedRows);
await c.end();
