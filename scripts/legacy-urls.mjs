import { config } from "dotenv";
import mysql from "mysql2/promise";
import Anthropic from "@anthropic-ai/sdk";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const ids = process.argv.slice(2).map(Number);
const EXCLUDE = /communityhub\.cloud|ai-microgrant|vercel\.app|anthropic|schema\.org|w3\.org|themoviedb|imdb|media-amazon/i;
for (const id of ids) {
  const [[s]] = await c.query("SELECT name, legacy_agent_id, url FROM sources WHERE id=?", [id]);
  if (!s?.legacy_agent_id) { console.log(`#${id} ${s?.name}: no legacy agent`); continue; }
  let sys = "";
  try { const a = await anthropic.beta.agents.retrieve(s.legacy_agent_id);
    sys = typeof a.system === "string" ? a.system : JSON.stringify(a.system ?? ""); }
  catch (e) { console.log(`#${id} ${s.name}: retrieve failed`); continue; }
  const spec = sys.slice(sys.search(/^##\s*Source-specific/im));
  const urls = [...new Set((spec.match(/https?:\/\/[^\s"'`)<>\]]+/gi) || [])
    .map(u => u.replace(/[.,;:]+$/,"")).filter(u => !EXCLUDE.test(u)))];
  console.log(`\n#${id} ${s.name}`);
  console.log(`   current: ${s.url ?? "(none)"}`);
  for (const u of urls.slice(0, 8)) console.log(`   legacy:  ${u}`);
}
await c.end();
