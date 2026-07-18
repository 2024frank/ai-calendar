import { config } from "dotenv";
import { parseVeeziSessions, dedupeFilms } from "../src/lib/sources/veezi";
import { buildApolloAnnouncements } from "../src/lib/sources/apolloSegments";
config({ path: new URL("../.env.local", import.meta.url) });

const token = process.env.APOLLO_VEEZI_SITE_TOKEN!;
const res = await fetch(`https://ticketing.uswest.veezi.com/sessions/?siteToken=${token}`, {
  headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36" },
});
const html = await res.text();
const films = dedupeFilms(parseVeeziSessions(html));
console.log(`parsed films: ${films.length}`);
for (const f of films) console.log(`  - ${f.title} (${f.showtimes.length} showtimes) code=${f.code}`);
const anns = buildApolloAnnouncements(films);
console.log(`\nannouncements: ${anns.length}`);
for (const a of anns) {
  console.log(`\n[${a.kind}] ${a.title}`);
  console.log(`  window: ${new Date(a.startTime*1000).toLocaleString("en-US",{timeZone:"America/New_York"})} -> ${new Date(a.endTime*1000).toLocaleString("en-US",{timeZone:"America/New_York"})}`);
  console.log(`  desc: ${a.description}`);
  console.log(`  movies: ${a.movies.map(m=>m.title).join(", ")}`);
}
