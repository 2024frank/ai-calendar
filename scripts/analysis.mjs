import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: databaseSsl(),
});

// Per-source discovery method + latest extraction run
const [sources] = await c.query(`
  SELECT s.id, s.name, s.active, s.discovery_status,
         JSON_EXTRACT(s.extraction_recipe,'$.extraction_method') AS method,
         JSON_EXTRACT(s.extraction_recipe,'$.endpoint_or_feed_url') AS endpoint
  FROM sources s ORDER BY s.id`);

const [latestExtract] = await c.query(`
  SELECT r1.source_id, r1.status, r1.events_found, r1.events_extracted, r1.events_duplicate, r1.events_invalid
  FROM runs r1
  JOIN (SELECT source_id, MAX(id) mid FROM runs WHERE run_kind='extraction' GROUP BY source_id) m
    ON r1.id=m.mid`);
const exBySrc = new Map(latestExtract.map(r=>[r.source_id,r]));

// Event-level stats
const [[ev]] = await c.query(`
  SELECT COUNT(*) total,
    SUM(status='pending') pending,
    SUM(status='duplicate') duplicate,
    SUM(image_cdn_url IS NOT NULL AND image_cdn_url<>'') with_image,
    SUM(rejection_reason IS NOT NULL) with_issues
  FROM events`);

// Category usage
const [cats] = await c.query(`SELECT post_type_ids, COUNT(*) n FROM events GROUP BY post_type_ids`);

// Validation issue frequency
const [issues] = await c.query(`SELECT rejection_reason FROM events WHERE rejection_reason IS NOT NULL`);
const issueCounts = {};
for (const r of issues) {
  const m = String(r.rejection_reason).replace(/^Required fields are missing:\s*/,'');
  for (const tok of m.split(',').map(x=>x.trim()).filter(Boolean)) issueCounts[tok]=(issueCounts[tok]||0)+1;
}

console.log("\n=== PER-SOURCE ===");
for (const s of sources) {
  const ex = exBySrc.get(s.id);
  console.log(`#${s.id} ${s.name}`);
  console.log(`   active=${s.active} discovery=${s.discovery_status} method=${s.method??'-'} endpoint=${(s.endpoint??'-').toString().slice(0,60)}`);
  if (ex) console.log(`   extraction: ${ex.status} found=${ex.events_found} review=${ex.events_extracted} dup=${ex.events_duplicate} issues=${ex.events_invalid}`);
  else console.log(`   extraction: (none)`);
}

console.log("\n=== EVENTS TOTALS ===");
console.log(ev);
console.log("\n=== CATEGORY COMBINATIONS ===");
for (const r of cats) console.log(`   ${r.post_type_ids} -> ${r.n}`);
console.log("\n=== VALIDATION ISSUE FREQUENCY ===");
for (const [k,v] of Object.entries(issueCounts).sort((a,b)=>b[1]-a[1])) console.log(`   ${k}: ${v}`);

const [[tok]] = await c.query(`SELECT SUM(prompt_tokens) in_tok, SUM(completion_tokens) out_tok FROM runs`);
console.log("\n=== TOKENS (all runs) ===");
console.log(`   input=${tok.in_tok} output=${tok.out_tok}`);
await c.end();
