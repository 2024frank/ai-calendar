import { config } from "dotenv";
import mysql from "mysql2/promise";

config({ path: ["/Users/kwaku/ai-calendar/.env.local", "/Users/kwaku/ai-calendar/.env"], quiet: true });

const runId = Number(process.argv[2] || 115);
const conn = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 25060),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: { rejectUnauthorized: false },
});

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
