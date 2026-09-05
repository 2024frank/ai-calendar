import { pathToFileURL } from "node:url";

const EVENT_ID = 1879;
const SOURCE_ID = 18;
const DUPLICATE_OF_EVENT_ID = 1797;
const REASON = "confirmed Apollo rolling-lineup false duplicate against event 1797";

class RepairBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "RepairBlockedError";
  }
}

function normalized(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function effectiveMode(row) {
  const raw = row.source_mode ?? row.community_default_mode ?? "needs_approval";
  return raw === "restricted" ? "needs_approval" : raw;
}

function sessions(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function localDateAtApollo(unixSeconds) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Number(unixSeconds) * 1000));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function assertExactEvent(row) {
  if (!row || Number(row.id) !== EVENT_ID) throw new RepairBlockedError("event id did not match 1879");
  if (Number(row.source_id) !== SOURCE_ID) throw new RepairBlockedError("source id did not match 18");
  if (row.source_slug !== "apollo-theater") throw new RepairBlockedError("source slug did not match apollo-theater");
  if (row.community_slug !== "oberlin") throw new RepairBlockedError("community slug did not match oberlin");
  if (row.status !== "duplicate") throw new RepairBlockedError("status is not duplicate");
  if (Number(row.duplicate_of_event_id) !== DUPLICATE_OF_EVENT_ID) {
    throw new RepairBlockedError("duplicate reference did not match event 1797");
  }
  if (normalized(row.title) !== "coming soon at the apollo") {
    throw new RepairBlockedError("title did not match Coming Soon at the Apollo");
  }
  const description = normalized(row.description);
  if (!description.startsWith("practical magic 2:")) {
    throw new RepairBlockedError("film description did not match Practical Magic 2");
  }
  if (description !== "practical magic 2: opens sep 10") {
    throw new RepairBlockedError("opening date text did not match Sep 10");
  }
  const hasExpectedDate = sessions(row.sessions).some(
    (session) => localDateAtApollo(session?.startTime) === "2026-09-10",
  );
  if (!hasExpectedDate) throw new RepairBlockedError("session date did not match Sep 10, 2026");
  if (effectiveMode(row) !== "needs_approval") {
    throw new RepairBlockedError("effective review mode is not needs_approval");
  }
  if (row.published_via != null) {
    throw new RepairBlockedError("publication marker is already stored on the event");
  }
}

function assertNoPublicationEvidence(rows) {
  const unsafe = rows.find(
    (row) => row.state !== "failed" || (row.external_post_id != null && row.external_post_id !== ""),
  );
  if (unsafe) throw new RepairBlockedError("publication evidence exists for event 1879");
}

function protectedEvidence(row) {
  return {
    duplicate_of_event_id: row.duplicate_of_event_id,
    duplicate_of_url: row.duplicate_of_url,
    dedup_key: row.dedup_key,
    rejection_reason: row.rejection_reason,
    field_notes: row.field_notes,
    corrected_at: row.corrected_at,
    published_via: row.published_via,
  };
}

async function lockedEvent(connection) {
  const [rows] = await connection.execute(
    `SELECT e.id, e.source_id, e.status, e.title, e.description, e.sessions,
            e.duplicate_of_event_id, e.duplicate_of_url, e.dedup_key,
            e.rejection_reason, e.field_notes, e.corrected_at, e.published_via,
            s.slug AS source_slug, s.mode AS source_mode,
            c.slug AS community_slug, c.default_mode AS community_default_mode
       FROM events e
       INNER JOIN sources s ON s.id = e.source_id
       INNER JOIN communities c ON c.id = e.community_id
      WHERE e.id = ?
      FOR UPDATE`,
    [EVENT_ID],
  );
  return rows[0] ?? null;
}

/**
 * Restore only the confirmed Apollo false-positive duplicate to human review.
 * Dry-run is the default. The supplied connection is the complete side-effect
 * boundary, which keeps imports and tests disconnected from environment/DB.
 */
export async function restoreApolloReview(connection, { apply = false } = {}) {
  if (apply !== true && apply !== false) throw new TypeError("apply must be true or false");

  await connection.beginTransaction();
  try {
    const before = await lockedEvent(connection);
    assertExactEvent(before);

    const [publicationRows] = await connection.execute(
      `SELECT state, external_post_id
         FROM publish_submissions
        WHERE event_id = ?
        FOR UPDATE`,
      [EVENT_ID],
    );
    assertNoPublicationEvidence(publicationRows);

    const result = {
      applied: apply,
      eventId: EVENT_ID,
      previousStatus: "duplicate",
      status: "pending",
      reason: REASON,
    };

    if (!apply) {
      await connection.rollback();
      return result;
    }

    const [update] = await connection.execute(
      `UPDATE events
          SET status = ?
        WHERE id = ? AND status = ? AND source_id = ? AND duplicate_of_event_id = ?`,
      ["pending", EVENT_ID, "duplicate", SOURCE_ID, DUPLICATE_OF_EVENT_ID],
    );
    if (Number(update?.affectedRows ?? 0) !== 1) {
      throw new RepairBlockedError("conditional event update did not affect exactly one row");
    }

    await connection.execute(
      `INSERT INTO activity_log
         (actor_user_id, actor_email, action, target_type, target_id, summary, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        null,
        null,
        "restore_review",
        "event",
        EVENT_ID,
        "System maintenance restored Apollo event #1879 to human review",
        JSON.stringify({
          previousStatus: "duplicate",
          status: "pending",
          sourceId: SOURCE_ID,
          duplicateOfEventId: DUPLICATE_OF_EVENT_ID,
          duplicateOfUrl: before.duplicate_of_url,
          reason: REASON,
        }),
      ],
    );

    const after = await lockedEvent(connection);
    if (!after || after.status !== "pending") {
      throw new RepairBlockedError("post-update status verification failed");
    }
    if (JSON.stringify(protectedEvidence(after)) !== JSON.stringify(protectedEvidence(before))) {
      throw new RepairBlockedError("post-update evidence preservation check failed");
    }

    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  }
}

function parseArgs(argv) {
  let apply = false;
  let envPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--env") {
      envPath = argv[index + 1] ?? null;
      if (!envPath || envPath.startsWith("--")) throw new Error("--env requires a file path");
      index += 1;
    } else if (arg.startsWith("--env=")) {
      envPath = arg.slice("--env=".length);
      if (!envPath) throw new Error("--env requires a file path");
    } else {
      throw new Error(`unknown flag: ${arg}`);
    }
  }
  return { apply, envPath };
}

async function main() {
  const { apply, envPath } = parseArgs(process.argv.slice(2));
  let checkedEnvPath = null;
  if (envPath) {
    const [{ access, realpath, stat }, { constants }] = await Promise.all([
      import("node:fs/promises"),
      import("node:fs"),
    ]);
    try {
      checkedEnvPath = await realpath(envPath);
      const info = await stat(checkedEnvPath);
      if (!info.isFile()) throw new Error("not a file");
      await access(checkedEnvPath, constants.R_OK);
    } catch {
      throw new RepairBlockedError("environment file path is not a readable file");
    }
  }
  const [{ config }, mysql, { databaseSsl }] = await Promise.all([
    import("dotenv"),
    import("mysql2/promise"),
    import("./db-ssl.mjs"),
  ]);
  config({
    path: checkedEnvPath
      ? [checkedEnvPath]
      : [new URL("../.env.local", import.meta.url), new URL("../.env", import.meta.url)],
    quiet: true,
  });

  const required = ["DATABASE_HOST", "DATABASE_USERNAME", "DATABASE_PASSWORD", "DATABASE_NAME"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new RepairBlockedError(`missing required environment names: ${missing.join(", ")}`);

  const connection = await mysql.default.createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 25060),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: databaseSsl(),
    connectTimeout: 15_000,
  });
  try {
    const result = await restoreApolloReview(connection, { apply });
    console.log(JSON.stringify(result));
  } finally {
    await connection.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    if (error instanceof RepairBlockedError) {
      console.error(`Apollo review repair blocked: ${error.message}`);
    } else {
      const code = typeof error?.code === "string" ? error.code : "unexpected_error";
      console.error(`Apollo review repair failed: ${code}`);
    }
    process.exitCode = 1;
  });
}
