import { config } from "dotenv";
import mysql from "mysql2/promise";
import Anthropic from "@anthropic-ai/sdk";

config({ path: new URL("../.env.local", import.meta.url) });

const APPLY = process.argv.includes("apply");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 25060),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
});

const EXCLUDE =
  /communityhub\.cloud|ai-microgrant|vercel\.app|\/api\/ingest|anthropic\.com|localhost|127\.0\.0\.1|schema\.org|w3\.org|example\.(com|org)|image\.tmdb|media-amazon|images\.locable|book\.peek|sitemap\.xml|\.(jpg|jpeg|png|gif|svg|webp)(\?|$)/i;

function cleanUrl(u) {
  // Drop a truncated array param like ...&exclude_type[  and any trailing separators.
  return u
    .replace(/[?&][^?&=]*\[$/, "")
    .replace(/[?&]$/, "")
    .replace(/[.,;:]+$/, "");
}

function pickUrl(prompt) {
  const urls = [...(prompt.matchAll(/https?:\/\/[^\s"'`)<>\]]+/gi) || [])].map((m) =>
    cleanUrl(m[0]),
  );
  const kept = urls.filter((u) => u && !EXCLUDE.test(u));
  const evented = kept.find((u) =>
    /event|calendar|whats-on|programs|shows|exhib|tickets|\/api\//i.test(u),
  );
  return {
    chosen: evented || kept.sort((a, b) => a.length - b.length)[0] || null,
    all: [...new Set(kept)],
  };
}

const [rows] = await c.query(
  "SELECT id, name, slug, url, legacy_agent_id FROM sources WHERE legacy_agent_id IS NOT NULL ORDER BY name",
);

for (const s of rows) {
  let system = "";
  try {
    const agent = await anthropic.beta.agents.retrieve(s.legacy_agent_id);
    system = typeof agent.system === "string" ? agent.system : JSON.stringify(agent.system ?? "");
  } catch (e) {
    console.log(`\n[${s.name}] retrieve failed: ${e.status || ""} ${e.message}`);
    continue;
  }
  const { chosen, all } = pickUrl(system);
  console.log(`\n[${s.name}] (slug=${s.slug}) currentUrl=${s.url ?? "none"}`);
  console.log(`  candidates: ${all.slice(0, 6).join("  ") || "(none found)"}`);
  console.log(`  chosen:     ${chosen ?? "(none)"}`);

  if (APPLY && chosen) {
    // Store the whole legacy prompt as special instructions (Discovery + Source read it).
    const instr = system.slice(0, 3800);
    await c.query(
      "UPDATE sources SET url = ?, start_urls = ?, special_instructions = ?, discovery_status = 'pending' WHERE id = ?",
      [chosen, JSON.stringify([chosen]), instr, s.id],
    );
    console.log("  APPLIED");
  }
}

await c.end();
console.log(APPLY ? "\nDone (applied)." : "\nDry run. Re-run with `apply` to set URLs.");
