import { config } from "dotenv";
import mysql from "mysql2/promise";

config({ path: new URL("../.env.local", import.meta.url) });

const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 25060),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
});

const [rows] = await c.query(
  `SELECT e.id, e.status, e.event_type, e.title, e.description, e.extended_description,
          e.sessions, e.location_type, e.location, e.post_type_ids, e.sponsors,
          e.registration_url, e.url_link, e.dedup_key, e.provenance, e.published_via,
          e.rejection_reason, s.name AS source
     FROM events e LEFT JOIN sources s ON s.id = e.source_id
    ORDER BY e.id`,
);

for (const r of rows) {
  const sess = (r.sessions || []).map(
    (x) => new Date(x.startTime * 1000).toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  console.log(`\n#${r.id} [${r.status}] type=${r.event_type} via=${r.published_via ?? "-"} (${r.source})`);
  console.log(`  title:      ${r.title}`);
  console.log(`  desc:       ${r.description}`);
  console.log(`  long:       ${(r.extended_description ?? "").slice(0, 110) || "(none)"}`);
  console.log(`  when:       ${sess.join(" | ")}`);
  console.log(`  location:   [${r.location_type}] ${r.location ?? "-"}`);
  console.log(`  categories: ${JSON.stringify(r.post_type_ids)}  sponsors: ${JSON.stringify(r.sponsors)}`);
  console.log(`  reg/url:    ${r.registration_url ?? "-"} | ${r.url_link ?? "-"}`);
  console.log(`  provenance: ${r.provenance}  dedup: ${String(r.dedup_key).slice(0, 12)}…`);
  if (r.rejection_reason) console.log(`  issues:     ${r.rejection_reason}`);
}
console.log(`\ntotal events: ${rows.length}`);
await c.end();
