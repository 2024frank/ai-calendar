import { config } from "dotenv";
import mysql from "mysql2/promise";
import Anthropic from "@anthropic-ai/sdk";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const APPLY = process.argv.includes("apply");
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});

// The generic "extraction and handoff contract" at the top of every legacy
// prompt was written for the old managed-agent architecture (its own tools, a
// raw JSON array, live inventory fetches). Our engine already enforces that
// contract deterministically, so keep only the SOURCE-SPECIFIC half, which is
// the real per-source knowledge and the part that was being lost.
const MARKER = /^##\s*Source-specific instructions.*$/im;

const [rows] = await c.query(
  "SELECT id,name,legacy_agent_id FROM sources WHERE legacy_agent_id IS NOT NULL AND legacy_agent_id <> '' ORDER BY id",
);
for (const s of rows) {
  let sys = "";
  try {
    const a = await anthropic.beta.agents.retrieve(s.legacy_agent_id);
    sys = typeof a.system === "string" ? a.system : JSON.stringify(a.system ?? "");
  } catch (e) {
    console.log(`#${s.id} ${s.name}: retrieve failed ${e.status ?? ""}`);
    continue;
  }
  const m = MARKER.exec(sys);
  const specific = m ? sys.slice(m.index).trim() : "";
  if (!specific) {
    console.log(`#${s.id} ${s.name}: no source-specific section (full ${sys.length}), leaving as is`);
    continue;
  }
  console.log(`#${s.id} ${s.name}: full=${sys.length} source-specific=${specific.length}`);
  if (APPLY) {
    await c.query("UPDATE sources SET special_instructions=? WHERE id=?", [specific, s.id]);
  }
}
await c.end();
console.log(APPLY ? "\nApplied full source-specific prompts." : "\nDry run. Re-run with `apply`.");
