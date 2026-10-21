import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: databaseSsl(),
});
// Token stays in env; the DB only ever holds the placeholder.
const url = "https://ticketing.uswest.veezi.com/sessions/?siteToken={APOLLO_VEEZI_SITE_TOKEN}";
const instructions = `This is the Apollo Theater's Veezi ticketing showtimes page. It lists each film with its showtimes grouped by date.

- Each "film" block is one movie, with its title and one or more dates, each date holding showtimes.
- Create ONE event per film, covering that film's showtimes. Use the film's first showtime as the event start and the last showtime of that same day as the end.
- The venue is always the Apollo Theater, 19 East College Street, Oberlin, OH 44074. locationType is "ph2".
- The sponsor is always "Apollo Theater" (the Oberlin theater, never Cleveland Cinemas).
- Category: use 5 (Film).
- Titles: use the film's own name as the title. Do not invent a marketing phrase.
- Ignore the browser-upgrade notice and any navigation text at the top of the page.`;

const [r] = await c.query(
  `UPDATE sources SET url=?, start_urls=?, special_instructions=?, active=1,
     discovery_status='pending', discovery_error=NULL,
     org_name='Apollo Theater', org_website='https://apollooberlin.com',
     calendar_source_name='Apollo Theater'
   WHERE id=1`,
  [url, JSON.stringify([url]), instructions],
);
console.log("apollo updated rows:", r.affectedRows);
await c.end();
