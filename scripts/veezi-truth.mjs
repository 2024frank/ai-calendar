import { config } from "dotenv";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const token = process.env.APOLLO_VEEZI_SITE_TOKEN;
const html = await (await fetch(`https://ticketing.uswest.veezi.com/sessions/?siteToken=${token}`, {
  headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36" },
})).text();

// crude parse: each .film block has a title and date-containers
const films = [];
for (const block of html.split(/class="film\s*"/i).slice(1)) {
  const title = (block.match(/class="title"[^>]*>\s*([^<]+?)\s*</i)?.[1] || "").replace(/&amp;/g,"&").trim();
  if (!title) continue;
  const dates = [];
  for (const dc of block.split(/class="date-container"/i).slice(1)) {
    const d = (dc.match(/class="date"[^>]*>\s*([^<]+?)\s*</i)?.[1] || "").trim();
    if (d) dates.push(d);
  }
  films.push({ title, dates });
}
console.log("TODAY:", new Date().toISOString().slice(0,10));
console.log("FILMS ON THE VEEZI PAGE:", films.length);
for (const f of films) {
  console.log(`  ${f.title}`);
  console.log(`     dates (${f.dates.length}): ${f.dates.join(" | ")}`);
}
