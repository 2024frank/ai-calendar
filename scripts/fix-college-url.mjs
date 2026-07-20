import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
// Exact URL from the legacy prompt, including the exclude_type[] filters that
// the first import stripped (that stripping is why campus-only events leaked).
const url = "https://calendar.oberlin.edu/api/2/events?days=180&pp=100&page=1&exclude_type[]=17705&exclude_type[]=39633026428602&exclude_type[]=39633028461305&exclude_type[]=39633032408215";
const [r] = await c.query(
  "UPDATE sources SET url=?, start_urls=?, extraction_recipe=JSON_SET(COALESCE(extraction_recipe,'{}'),'$.endpoint_or_feed_url',?,'$.canonical_listing_url',?) WHERE id=2",
  [url, JSON.stringify([url]), url, url],
);
console.log("college url restored, rows:", r.affectedRows);
console.log(url);
await c.end();
