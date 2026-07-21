import { config } from "dotenv";
import mysql from "mysql2/promise";

config({ path: ["/Users/kwaku/ai-calendar/.env.local", "/Users/kwaku/ai-calendar/.env"], quiet: true });

const sourceId = Number(process.argv[2] || 20);
const sinceId = Number(process.argv[3] || 0); // only runs newer than this
const conn = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 25060),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
});

// Wait for a new run on this source.
let runId = 0;
for (;;) {
  const [[r]] = await conn.query(
    "SELECT id FROM runs WHERE source_id=? AND id>? ORDER BY id DESC LIMIT 1",
    [sourceId, sinceId],
  );
  if (r) {
    runId = r.id;
    console.log(`RUN ${runId} STARTED for source ${sourceId}`);
    break;
  }
  await new Promise((res) => setTimeout(res, 8000));
}

let lastId = 0;
for (;;) {
  const [evs] = await conn.query(
    "SELECT id, kind, label FROM run_events WHERE run_id=? AND id>? ORDER BY id ASC",
    [runId, lastId],
  );
  for (const e of evs) {
    console.log(`${e.kind} | ${String(e.label).slice(0, 150)}`);
    lastId = e.id;
  }
  const [[r]] = await conn.query("SELECT status, phase FROM runs WHERE id=?", [runId]);
  if (r && r.status !== "running") {
    console.log(`RUN ${runId} TERMINAL: ${r.status} (phase ${r.phase})`);
    break;
  }
  await new Promise((res) => setTimeout(res, 10000));
}
await conn.end();
