import { databaseSsl } from "./db-ssl.mjs";
import { config } from "dotenv";
import mysql from "mysql2/promise";
import { readdirSync, readFileSync } from "fs";

config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)] });

const ssl = databaseSsl();
const SCRATCH =
  "/private/tmp/claude-503/-Users-kwaku/d0f64b71-6074-454c-96e3-db9511cdefa2/scratchpad";

const TAXONOMY = {
  postTypeIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 59, 89],
  labels: {
    1: "Volunteer Opportunity",
    2: "Exhibit",
    3: "Fair, Festival, or Public Celebration",
    4: "Tour, Walking Tours or Open House",
    5: "Film",
    6: "Presentation or Lecture",
    7: "Workshop or Class",
    8: "Music Performance",
    9: "Theatre or Dance",
    10: "City Government",
    11: "Spectator Sport",
    12: "Participatory Sport or Game",
    13: "Networking Event",
    59: "Ecolympics or Environmental",
    89: "Other",
  },
};

function chConfig(host, chCommunityId, extra = {}) {
  const base = `https://${host}`;
  return {
    api_base: base,
    submit_url: `${base}/api/legacy/calendar/post/submit`,
    edit_url_tmpl: `${base}/api/legacy/calendar/post/{id}/submit`,
    patch_url_tmpl: `${base}/api/legacy/calendar/post/{id}/submit`,
    inventory_url: `${base}/api/legacy/calendar/posts?limit=10000&page=0&filter=future&tab=main-feed&isJobs=false&order=ASC&postType=All&allPosts`,
    ch_community_id: chCommunityId,
    timezone: "America/New_York",
    taxonomy: TAXONOMY,
    ...extra,
  };
}

function latestBackup() {
  const files = readdirSync(SCRATCH)
    .filter((f) => f.startsWith("oberlin-calendar-backup-") && f.endsWith(".json"))
    .sort();
  if (!files.length) return null;
  return JSON.parse(readFileSync(`${SCRATCH}/${files[files.length - 1]}`, "utf8"));
}

async function upsertCommunity(c, slug, name) {
  await c.query(
    `INSERT INTO communities (slug, name, timezone, default_mode, status)
     VALUES (?, ?, 'America/New_York', 'restricted', 'active')
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [slug, name],
  );
  const [[row]] = await c.query("SELECT id FROM communities WHERE slug = ?", [slug]);
  return row.id;
}

async function ensureChDestination(c, communityId, name, cfg, active) {
  const [existing] = await c.query(
    "SELECT id FROM destinations WHERE community_id = ? AND type = 'communityhub' LIMIT 1",
    [communityId],
  );
  if (existing.length) {
    await c.query("UPDATE destinations SET name = ?, config = ?, active = ? WHERE id = ?", [
      name,
      JSON.stringify(cfg),
      active ? 1 : 0,
      existing[0].id,
    ]);
    return existing[0].id;
  }
  const [res] = await c.query(
    "INSERT INTO destinations (community_id, name, type, config, active) VALUES (?, ?, 'communityhub', ?, ?)",
    [communityId, name, JSON.stringify(cfg), active ? 1 : 0],
  );
  return res.insertId;
}

async function main() {
  if (process.env.DATABASE_NAME !== "oberlin-calendar") {
    console.error("SAFETY ABORT: not oberlin-calendar");
    process.exit(1);
  }
  const c = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 25060),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl,
    connectTimeout: 15000,
  });

  // 1) Communities
  const oberlinId = await upsertCommunity(c, "oberlin", "Oberlin");
  const clevelandId = await upsertCommunity(c, "cleveland", "Cleveland");

  // 2) CommunityHub endpoints
  const oberlinDest = await ensureChDestination(
    c,
    oberlinId,
    "Oberlin CommunityHub",
    chConfig("oberlin.communityhub.cloud", 2),
    true,
  );
  // Cleveland endpoint is a provisional placeholder (host/taxonomy unconfirmed) — inactive
  // so Cleveland defaults to its own AI calendar until confirmed.
  await ensureChDestination(
    c,
    clevelandId,
    "Cleveland CommunityHub (unconfirmed)",
    chConfig("cleveland.communityhub.cloud", 3, { needs_confirmation: true }),
    false,
  );

  // Oberlin defaults to publishing to CommunityHub; Cleveland to its AI calendar.
  await c.query("UPDATE communities SET default_destination_id = ? WHERE id = ?", [
    oberlinDest,
    oberlinId,
  ]);

  // 3) Platform admin (you)
  await c.query(
    `INSERT INTO users (community_id, role, email, name, can_review_all_sources, status)
     VALUES (NULL, 'platform_admin', ?, ?, true, 'active')
     ON DUPLICATE KEY UPDATE role = 'platform_admin', name = VALUES(name), can_review_all_sources = true`,
    ["fkusiapp@oberlin.edu", "Frank Kusi Appiah"],
  );

  // 4) Import Oberlin sources from backup
  const backup = latestBackup();
  const oldSources = backup?.tables?.sources?.rows ?? [];
  let imported = 0;
  for (const s of oldSources) {
    const sourceType = s.source_type === "email" ? "email" : "web";
    const sourceKind = s.source_kind === "aggregator" ? "aggregator" : "original_org";
    const url = s.url ?? s.calendar_source_url ?? null;
    const startUrls = url ? JSON.stringify([url]) : null;
    const discoveryStatus = s.agent_id ? "ready" : "pending";
    await c.query(
      `INSERT INTO sources
        (community_id, name, slug, source_type, source_kind, url, schedule_cron, active,
         calendar_source_name, calendar_source_url, org_website, org_phone, org_contact_email,
         legacy_agent_id, discovery_status, start_urls, destination_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), source_type = VALUES(source_type), source_kind = VALUES(source_kind),
         url = VALUES(url), schedule_cron = VALUES(schedule_cron), active = VALUES(active),
         legacy_agent_id = VALUES(legacy_agent_id), discovery_status = VALUES(discovery_status),
         start_urls = VALUES(start_urls), destination_id = VALUES(destination_id)`,
      [
        oberlinId,
        s.name,
        s.slug,
        sourceType,
        sourceKind,
        url,
        s.schedule_cron ?? null,
        s.active ? 1 : 0,
        s.calendar_source_name ?? null,
        s.calendar_source_url ?? null,
        s.org_website ?? null,
        s.org_phone ?? null,
        s.org_contact_email ?? null,
        s.agent_id ?? null,
        discoveryStatus,
        startUrls,
        oberlinDest,
      ],
    );
    imported++;
  }

  // Summary
  const [[{ nc }]] = await c.query("SELECT COUNT(*) nc FROM communities");
  const [[{ nd }]] = await c.query("SELECT COUNT(*) nd FROM destinations");
  const [[{ nu }]] = await c.query("SELECT COUNT(*) nu FROM users");
  const [[{ ns }]] = await c.query("SELECT COUNT(*) ns FROM sources");
  console.log("SEED COMPLETE");
  console.log(`  communities: ${nc} (oberlin=${oberlinId}, cleveland=${clevelandId})`);
  console.log(`  destinations: ${nd}`);
  console.log(`  users: ${nu} (platform_admin: fkusiapp@oberlin.edu)`);
  console.log(`  sources imported into Oberlin: ${imported} (total sources: ${ns})`);
  await c.end();
}

main().catch((e) => {
  console.error("SEED ERROR:", e.code || "", e.sqlMessage || e.message);
  process.exit(1);
});
