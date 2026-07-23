import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";

config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });
const ssl = databaseSsl();

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 25060),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl,
    connectTimeout: 15000,
  });

  const [comms] = await c.query(
    "SELECT id, slug, name, default_mode, default_destination_id FROM communities ORDER BY id",
  );
  console.log("COMMUNITIES:");
  for (const x of comms)
    console.log(
      `  #${x.id} ${x.slug} (${x.name})  mode=${x.default_mode}  defaultDest=${x.default_destination_id ?? "AI calendar"}`,
    );

  const [dests] = await c.query(
    "SELECT id, community_id, name, type, active, JSON_EXTRACT(config,'$.ch_community_id') ch FROM destinations ORDER BY id",
  );
  console.log("\nDESTINATIONS:");
  for (const d of dests)
    console.log(
      `  #${d.id} community=${d.community_id} ${d.type} "${d.name}" active=${d.active} ch_community_id=${d.ch}`,
    );

  const [usr] = await c.query("SELECT email, role, community_id FROM users ORDER BY id");
  console.log("\nUSERS:");
  for (const u of usr) console.log(`  ${u.email} role=${u.role} community=${u.community_id ?? "-"}`);

  const [src] = await c.query(
    "SELECT name, slug, source_type, active, discovery_status, legacy_agent_id FROM sources ORDER BY id",
  );
  console.log(`\nSOURCES (${src.length}):`);
  for (const s of src)
    console.log(
      `  - ${s.name} [${s.source_type}] active=${s.active} discovery=${s.discovery_status} agentPrompt=${s.legacy_agent_id ? "importable" : "none"}`,
    );
  await c.end();
}
main().catch((e) => {
  console.error("VERIFY ERROR:", e.code || "", e.sqlMessage || e.message);
  process.exit(1);
});
