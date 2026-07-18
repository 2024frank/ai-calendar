import { config } from "dotenv";
import mysql from "mysql2/promise";
import { SignJWT } from "jose";
config({ path: new URL("../.env.local", import.meta.url) });
const BASE = "http://localhost:3000";
const ids = process.argv.slice(2).map(Number);
const c = mysql.createPool({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false }, connectionLimit: 2, enableKeepAlive: true, idleTimeout: 0,
});
const [[u]] = await c.query("SELECT id,email,name,role,community_id,can_review_all_sources FROM users WHERE email='fkusiapp@gmail.com' LIMIT 1");
const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET);
const jwt = await new SignJWT({ uid:u.id,email:u.email,name:u.name??null,role:u.role,communityId:u.community_id??null,canReviewAllSources:!!u.can_review_all_sources })
  .setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("7d").sign(secret);
const COOKIE=`ac_session=${jwt}`;
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
async function post(p){const r=await fetch(BASE+p,{method:"POST",headers:{cookie:COOKIE}});let j;try{j=JSON.parse(await r.text())}catch{j={}}return{status:r.status,...j};}
async function waitRun(id){for(;;){const[[r]]=await c.query("SELECT status,events_found,events_extracted,events_duplicate,events_invalid FROM runs WHERE id=?",[id]);if(!r)return{status:"missing"};if(r.status!=="running")return r;await new Promise(s=>setTimeout(s,5000));}}
async function last(id){const[[e]]=await c.query("SELECT kind,label FROM run_events WHERE run_id=? ORDER BY id DESC LIMIT 1",[id]);return e?`${e.kind}: ${e.label}`:"";}
for(const id of ids){
  const [[s]]=await c.query("SELECT id,name,discovery_status FROM sources WHERE id=?",[id]);
  log(`[${s.name}] discovery_status=${s.discovery_status}`);
  if(s.discovery_status!=="ready"){
    const d=await post(`/api/sources/${id}/discover`);
    if(!d.runId){log(`[${s.name}] discover trigger failed`,d);continue;}
    const dr=await waitRun(d.runId);log(`[${s.name}] discovery ${dr.status} — ${await last(d.runId)}`);
    if(dr.status!=="completed")continue;
  }
  const e=await post(`/api/sources/${id}/run`);
  if(!e.runId){log(`[${s.name}] run trigger failed`,e);continue;}
  const er=await waitRun(e.runId);
  log(`[${s.name}] extraction ${er.status} — found=${er.events_found} review=${er.events_extracted} dup=${er.events_duplicate} issues=${er.events_invalid} | ${await last(e.runId)}`);
}
await c.end();log("subset done");
