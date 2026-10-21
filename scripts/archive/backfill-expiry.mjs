import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";

config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });

/**
 * Give past events a date the expiry sweep can see.
 *
 * The sweep only ever looked at rows with a non-null start_time_max, so any row
 * that never got one was invisible to it and sat in the review queue forever.
 * That is how a reviewer kept seeing events whose dates had long gone. Worse,
 * the query used to verify the sweep carried the same blind spot, so the check
 * and the bug agreed with each other.
 *
 * This fills the column in from the sessions the row already holds, using the
 * LATEST SESSION START: the last date the event still has ahead of it, which is
 * what decides when it is finished. Rows with no sessions at all are left alone
 * here; the sweep ages those out itself.
 *
 * Read-only by default. Pass --write to apply.
 */
const WRITE = process.argv.includes("--write");

const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 25060),
  user: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: databaseSsl(),
});

// Every row with sessions, not only the ones missing a value. The column used
// to hold the last session END and now holds the last session START, so rows
// written under the old rule would otherwise linger past the day they should go.
const [rows] = await c.query(
  `select id, title, status, sessions, start_time_max
     from events
    where sessions is not null
      and json_length(sessions) > 0`,
);

console.log(`rows with dates to recompute: ${rows.length}`);

const nowSecs = Math.floor(Date.now() / 1000);
let fixed = 0;
let past = 0;

for (const row of rows) {
  const sessions = typeof row.sessions === "string" ? JSON.parse(row.sessions) : row.sessions;
  const starts = (Array.isArray(sessions) ? sessions : [])
    .map((s) => Number(s?.startTime))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!starts.length) continue;

  const latestStart = Math.max(...starts);
  if (Number(row.start_time_max) === latestStart) continue; // already correct
  if (latestStart < nowSecs) past++;
  if (WRITE) {
    await c.query("update events set start_time_max = ? where id = ?", [latestStart, row.id]);
  }
  fixed++;
  if (fixed <= 15) {
    const when = new Date(latestStart * 1000).toISOString().slice(0, 10);
    console.log(
      `  ${WRITE ? "set" : "would set"} ${String(row.id).padEnd(6)} ${when}` +
        `${latestStart < nowSecs ? "  (already over)" : ""}  ${String(row.title).slice(0, 50)}`,
    );
  }
}
if (fixed > 15) console.log(`  ... and ${fixed - 15} more`);

console.log(
  `\n${WRITE ? "updated" : "would update"} ${fixed} row(s); ${past} of them are already over ` +
    `and the next sweep will delete them.`,
);
if (!WRITE) console.log("Nothing was changed. Re-run with --write to apply.");

await c.end();
