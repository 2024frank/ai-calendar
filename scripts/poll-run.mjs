import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const runId = Number(process.argv[2]);
const t0 = Date.now();
for (;;) {
  const [[r]] = await c.query("SELECT status,phase,run_kind,events_found,events_extracted,prompt_tokens,completion_tokens FROM runs WHERE id=?",[runId]);
  const [[e]] = await c.query("SELECT kind,label FROM run_events WHERE run_id=? ORDER BY id DESC LIMIT 1",[runId]);
  process.stdout.write(`\r${((Date.now()-t0)/1000).toFixed(0)}s ${r.run_kind} ${r.status} | ${e?.kind}: ${(e?.label||'').slice(0,70)}          `);
  if (r.status !== "running" || Date.now()-t0 > 240000) { console.log("\nFINAL:", JSON.stringify(r)); break; }
  await new Promise(res=>setTimeout(res,3000));
}
await c.end();
