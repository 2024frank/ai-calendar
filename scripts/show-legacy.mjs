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
const id = Number(process.argv[2]);
const [[s]] = await c.query("SELECT name, legacy_agent_id FROM sources WHERE id=?", [id]);
const a = await anthropic.beta.agents.retrieve(s.legacy_agent_id);
const sys = typeof a.system === "string" ? a.system : JSON.stringify(a.system);
console.log(`=== ${s.name} (${s.legacy_agent_id}) full length=${sys.length} ===`);
console.log(sys);
await c.end();
