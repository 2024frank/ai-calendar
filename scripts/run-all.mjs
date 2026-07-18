import { config } from "dotenv";
import mysql from "mysql2/promise";
import { SignJWT } from "jose";
config({ path: new URL("../.env.local", import.meta.url) });

const BASE = "http://localhost:3000";
const c = mysql.createPool({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false }, connectionLimit: 2, enableKeepAlive: true, idleTimeout: 0,
});

// admin cookie
const [[u]] = await c.query("SELECT id,email,name,role,community_id,can_review_all_sources FROM users WHERE email='fkusiapp@gmail.com' LIMIT 1");
const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET);
const jwt = await new SignJWT({ uid:u.id,email:u.email,name:u.name??null,role:u.role,communityId:u.community_id??null,canReviewAllSources:!!u.can_review_all_sources })
  .setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("7d").sign(secret);
const COOKIE = `ac_session=${jwt}`;

const log = (...a) => console.log(new Date().toISOString().slice(11,19), ...a);

// Never wipe before collecting. Each source's previous events are replaced only
// after that source has successfully produced new ones, so a failed run (or an
// API outage) can never leave the calendar empty.
const runStartedAt = new Date();
log(`collecting; existing events are replaced per source only on success`);

async function post(path) {
  const r = await fetch(BASE + path, { method: "POST", headers: { cookie: COOKIE } });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0,200) }; }
  return { status: r.status, ...j };
}
async function runStatus(runId) {
  const [[r]] = await c.query("SELECT status,phase,events_found,events_extracted,events_duplicate,events_invalid FROM runs WHERE id=?", [runId]);
  return r;
}
async function waitRun(runId) {
  // Never give up on a run: some sources legitimately take many minutes.
  for (;;) {
    const r = await runStatus(runId);
    if (!r) return { status: "missing" };
    if (r.status !== "running") return r;
    await new Promise((res) => setTimeout(res, 5000));
  }
}
async function lastEmit(runId) {
  const [[e]] = await c.query("SELECT kind,label FROM run_events WHERE run_id=? ORDER BY id DESC LIMIT 1",[runId]);
  return e ? `${e.kind}: ${e.label}` : "(no events)";
}

const [srcs] = await c.query(
  "SELECT id,name,discovery_status FROM sources WHERE active=1 AND source_type='web' AND url IS NOT NULL ORDER BY id"
);
log(`running ${srcs.length} active web source(s)`);

const results = [];
for (const s of srcs) {
  const row = { id: s.id, name: s.name };
  try {
    // Discovery (skip only if already ready with a recipe)
    if (s.discovery_status !== "ready") {
      log(`[${s.name}] discovery…`);
      const d = await post(`/api/sources/${s.id}/discover`);
      if (!d.runId) { row.discovery = `trigger failed (${d.status} ${d.error||d.raw||""})`; results.push(row); continue; }
      const dr = await waitRun(d.runId);
      row.discovery = dr.status;
      row.discoveryLast = await lastEmit(d.runId);
      log(`[${s.name}] discovery ${dr.status} — ${row.discoveryLast}`);
      if (dr.status !== "completed") { results.push(row); continue; }
    } else {
      row.discovery = "already-ready";
    }
    // Extraction
    log(`[${s.name}] extraction…`);
    const e = await post(`/api/sources/${s.id}/run`);
    if (!e.runId) { row.extraction = `trigger failed (${e.status} ${e.error||e.raw||""})`; results.push(row); continue; }
    const er = await waitRun(e.runId);
    row.extraction = er.status;
    row.found = er.events_found; row.inserted = er.events_extracted;
    row.duplicate = er.events_duplicate; row.invalid = er.events_invalid;
    row.extractionLast = await lastEmit(e.runId);
    log(`[${s.name}] extraction ${er.status} — found=${er.events_found} review=${er.events_extracted} dup=${er.events_duplicate} issues=${er.events_invalid}`);

    // Success: drop this source's older events, keeping only what this run found.
    if (er.status === "completed" && Number(er.events_found) > 0) {
      const [swap] = await c.query(
        "DELETE FROM events WHERE source_id = ? AND created_at < ?",
        [s.id, runStartedAt],
      );
      if (swap.affectedRows) log(`[${s.name}] replaced ${swap.affectedRows} older event(s)`);
    }
  } catch (err) {
    row.error = String(err.message||err);
    log(`[${s.name}] ERROR ${row.error}`);
  }
  results.push(row);
}

log("=== SUMMARY ===");
for (const r of results) log(JSON.stringify(r));
await c.end();
log("done");
