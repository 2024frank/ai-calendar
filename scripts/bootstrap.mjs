import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bootstrapDatabaseOptions, bootstrapOptions } from "./bootstrap-options.mjs";

const HELP = `Initialize a migrated AI Calendar database for any community.

Usage:
  node scripts/bootstrap.mjs --community-slug east-lake --community-name "East Lake" --admin-email admin@example.org

Required (or provide the matching environment variable):
  --community-slug   BOOTSTRAP_COMMUNITY_SLUG
  --community-name   BOOTSTRAP_COMMUNITY_NAME
  --admin-email      BOOTSTRAP_ADMIN_EMAIL
Optional:
  --timezone        BOOTSTRAP_TIMEZONE (default: UTC)
  --admin-name      BOOTSTRAP_ADMIN_NAME

Database: DATABASE_HOST, DATABASE_PORT, DATABASE_USERNAME, DATABASE_PASSWORD,
DATABASE_NAME; TLS options follow scripts/db-ssl.mjs. Apply migrations first.

New communities require human approval and have no publishing destination.
Existing settings, passwords and roles are preserved. The administrator uses
the application's first-time/forgot-password email flow; no password is seeded.`;

/** All statements run inside one transaction; repeated runs preserve settings. */
export async function bootstrapDatabase(connection, options) {
  await connection.beginTransaction();
  try {
    // LAST_INSERT_ID makes both the first insert and an existing slug resolve
    // to the same ID without rewriting the community's publishing settings.
    const [communityResult] = await connection.execute(
      `INSERT INTO communities (slug, name, timezone, default_mode, default_destination_id, status)
       VALUES (?, ?, ?, 'needs_approval', NULL, 'active')
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [options.communitySlug, options.communityName, options.timezone],
    );
    const communityId = Number(communityResult.insertId);

    // A platform admin spans communities, so community_id is intentionally NULL
    // and no user_communities membership is needed. Never elevate an existing
    // reviewer or reactivate a disabled account as a side effect of re-running.
    await connection.execute(
      `INSERT INTO users (community_id, role, email, name, password_hash, must_set_password, can_review_all_sources, status)
       VALUES (NULL, 'platform_admin', ?, ?, NULL, true, true, 'active')
       ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
      [options.adminEmail, options.adminName],
    );
    const [admins] = await connection.execute(
      "SELECT id, role, status FROM users WHERE email = ? FOR UPDATE", [options.adminEmail],
    );
    const admin = admins[0];
    if (!admin || admin.role !== "platform_admin" || admin.status !== "active") {
      throw new Error("The administrator email belongs to an existing non-platform or disabled account. Use the app to review its access; bootstrap will not change it.");
    }
    if (!Number.isSafeInteger(communityId) || communityId < 1) throw new Error("The database did not return a community ID.");
    await connection.commit();
    return { communityId, adminId: Number(admin.id) };
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  }
}

async function main() {
  const { config } = await import("dotenv");
  config({ path: [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)], quiet: true });
  const options = bootstrapOptions();
  if (options.help) {
    console.log(HELP);
    return;
  }
  const databaseOptions = bootstrapDatabaseOptions();
  const { default: mysql } = await import("mysql2/promise");
  const connection = await mysql.createConnection(databaseOptions);
  try {
    const result = await bootstrapDatabase(connection, options);
    console.log(`Bootstrap complete: community ${options.communitySlug} (ID ${result.communityId}), administrator ID ${result.adminId}.`);
    console.log("Existing settings were preserved. Newly created communities require review and have no publishing destination.");
    console.log("Configure email delivery, start the app, open /login and choose First Time Here or Forgot Password using the administrator email.");
    console.log("No password, login token, destination or event was created by this script.");
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    // Driver errors can contain SQL fragments; report their code instead.
    console.error("Bootstrap failed:", error.code || error.message);
    process.exitCode = 1;
  });
}
