import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url)] });
const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT || 25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
});
const [r] = await c.query(`select r.id, s.name src, r.run_kind kind, r.status, r.phase,
  r.events_found f, r.events_extracted x, round(r.cost_micros/1000000,2) usd, r.started_at
  from runs r left join sources s on s.id=r.source_id
  where r.started_at > date_sub(now(), interval 7 day)
  order by r.id desc limit 20`);
console.table(r);
const [tally] = await c.query(`select status, count(*) n from runs
  where run_kind='extraction' and started_at > date_sub(now(), interval 7 day) group by status`);
console.table(tally);
await c.end();
