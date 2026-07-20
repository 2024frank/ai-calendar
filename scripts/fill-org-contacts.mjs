import { config } from "dotenv";
import mysql from "mysql2/promise";
config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const APPLY = process.argv.includes("apply");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const BAD_EMAIL = /(example|sentry|\.png|\.jpg|wixpress|godaddy|weebly|squarespace|@2x)/i;
// Template placeholders and fake TLDs that scrapers pick up from boilerplate.
const PLACEHOLDER = /^(you|your|youremail|name|email|firstname|someone|user)@/i;
const REAL_TLD = /\.(com|org|net|edu|gov|us|io|co|info)$/i;

function goodEmail(e) {
  return e && !BAD_EMAIL.test(e) && !PLACEHOLDER.test(e) && REAL_TLD.test(e);
}
function fmtPhone(p) {
  const d = String(p).replace(/\D/g, "").replace(/^1/, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : p;
}

async function grab(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; }
}
function findEmail(html) {
  const m = [...html.matchAll(/mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi)].map(x => x[1]);
  const t = [...html.matchAll(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi)].map(x => x[1]);
  return [...m, ...t].find(goodEmail) || "";
}
function findPhone(html) {
  const text = html.replace(/<[^>]+>/g, " ");
  const m = text.match(/\(?\b(?:216|440|330|234)\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
  return m ? fmtPhone(m[0].trim()) : "";
}

const c = await mysql.createConnection({
  host: process.env.DATABASE_HOST, port: Number(process.env.DATABASE_PORT||25060),
  user: process.env.DATABASE_USERNAME, password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME, ssl: { rejectUnauthorized: false },
});
const [rows] = await c.query("SELECT id,name,url,org_contact_email,org_phone,org_website FROM sources WHERE url IS NOT NULL ORDER BY id");

for (const s of rows) {
  const origin = new URL(s.url).origin;
  let html = await grab(s.url);
  let email = findEmail(html), phone = findPhone(html);
  if (!email || !phone) {
    for (const p of ["/contact", "/contact-us", "/about", "/"]) {
      if (email && phone) break;
      const h = await grab(origin + p);
      if (!h) continue;
      email = email || findEmail(h);
      phone = phone || findPhone(h);
    }
  }
  console.log(`#${s.id} ${s.name}`);
  console.log(`   email: ${email || "(none found)"}   phone: ${phone || "(none found)"}   site: ${origin}`);
  if (APPLY) {
    await c.query(
      "UPDATE sources SET org_contact_email=COALESCE(NULLIF(?,''),org_contact_email), org_phone=COALESCE(NULLIF(?,''),org_phone), org_website=COALESCE(NULLIF(?,''),org_website) WHERE id=?",
      [email, phone, origin, s.id]
    );
  }
}
await c.end();
console.log(APPLY ? "\nApplied." : "\nDry run. Re-run with `apply`.");
