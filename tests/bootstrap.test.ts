import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootstrapOptions, bootstrapDatabaseOptions } from "../scripts/bootstrap-options.mjs";
import { bootstrapDatabase } from "../scripts/bootstrap.mjs";

const args = ["--community-slug", " East-Lake ", "--community-name", " East Lake ", "--admin-email", " ADMIN@EXAMPLE.ORG "];
const database = { DATABASE_HOST: "localhost", DATABASE_PORT: "3306", DATABASE_USERNAME: "calendar", DATABASE_PASSWORD: "local-test-password", DATABASE_NAME: "my_calendar" };

describe("portable bootstrap configuration", () => {
  it("normalizes explicit community identity and administrator email", () => {
    assert.deepEqual(bootstrapOptions(args, {}), {
      help: false, communitySlug: "east-lake", communityName: "East Lake", adminEmail: "admin@example.org", adminName: null, timezone: "UTC",
    });
  });

  it("supports environment defaults and explicit CLI overrides", () => {
    const options = bootstrapOptions(["--timezone", "Europe/London", "--admin-name", "Alex Rivera"], {
      BOOTSTRAP_COMMUNITY_SLUG: "east-lake", BOOTSTRAP_COMMUNITY_NAME: "East Lake",
      BOOTSTRAP_ADMIN_EMAIL: "admin@example.org", BOOTSTRAP_TIMEZONE: "America/New_York",
    });
    assert.equal(options.timezone, "Europe/London");
    assert.equal(options.adminName, "Alex Rivera");
  });

  it("requires explicit identities instead of inheriting the original deployment", () => {
    assert.throws(() => bootstrapOptions([], {}), /community-slug/);
    assert.throws(() => bootstrapOptions(args.slice(0, 4), {}), /admin-email/);
  });

  it("rejects invalid slugs, email addresses, timezone values and unexpected flags", () => {
    for (const [flag, value] of [
      ["--community-slug", "../other"], ["--community-slug", "a".repeat(81)],
      ["--community-name", "\nInjected"], ["--admin-email", "admin@"],
      ["--admin-email", "first@example.org\nsecond@example.org"],
      ["--timezone", "Somewhere/Unknown"], ["--password", "never-accepted"],
    ]) {
      assert.throws(() => bootstrapOptions([...args, flag, value], {}), flag);
    }
  });

  it("prints help without needing a database or operator identity", () => {
    assert.deepEqual(bootstrapOptions(["--help"], {}), { help: true });
  });

  it("uses the explicitly configured database rather than a fixed deployment name", () => {
    const options = bootstrapDatabaseOptions(database);
    assert.equal(options.database, "my_calendar");
    assert.equal(options.port, 3306);
    assert.equal(options.multipleStatements, false);
  });

  it("refuses missing database configuration and invalid ports", () => {
    assert.throws(() => bootstrapDatabaseOptions({}), /DATABASE_HOST/);
    assert.throws(() => bootstrapDatabaseOptions({ ...database, DATABASE_NAME: "" }), /DATABASE_NAME/);
    for (const port of ["", "0", "65536", "3306x", "3.5"]) {
      assert.throws(() => bootstrapDatabaseOptions({ ...database, DATABASE_PORT: port }), /DATABASE_PORT/);
    }
  });

  it("keeps remote database certificate verification enabled", () => {
    const options = bootstrapDatabaseOptions({ ...database, DATABASE_HOST: "db.example.org" });
    assert.deepEqual(options.ssl, { rejectUnauthorized: true });
    assert.throws(() => bootstrapDatabaseOptions({ ...database, DATABASE_HOST: "db.example.org", DATABASE_SSL: "false" }), /loopback/);
  });
});

describe("bootstrap transaction", () => {
  function connection(role = "platform_admin") {
    const state = { commits: 0, rollbacks: 0, statements: [] as string[] };
    return {
      state,
      beginTransaction: async () => undefined,
      commit: async () => { state.commits++; },
      rollback: async () => { state.rollbacks++; },
      execute: async (query: string) => {
        state.statements.push(query);
        if (query.startsWith("INSERT INTO communities")) return [{ insertId: 37 }];
        if (query.startsWith("INSERT INTO users")) return [{ insertId: 8 }];
        if (query.startsWith("SELECT id, role, status FROM users")) return [[{ id: 8, role, status: "active" }]];
        throw new Error(`Unexpected database operation: ${query}`);
      },
    };
  }

  it("commits stable identities while its duplicate-key clauses preserve existing settings", async () => {
    const db = connection();
    const options = bootstrapOptions(args, {});
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.deepEqual(await bootstrapDatabase(db, options), { communityId: 37, adminId: 8 });
    }
    assert.equal(db.state.commits, 2);
    assert.equal(db.state.rollbacks, 0);
    for (const statement of db.state.statements.filter((query) => query.startsWith("INSERT"))) {
      assert.equal(statement.split("ON DUPLICATE KEY UPDATE")[1].trim(), "id = LAST_INSERT_ID(id)");
    }
  });

  it("rolls back instead of silently elevating an existing reviewer", async () => {
    const db = connection("reviewer");
    await assert.rejects(() => bootstrapDatabase(db, bootstrapOptions(args, {})), /will not change it/);
    assert.equal(db.state.commits, 0);
    assert.equal(db.state.rollbacks, 1);
  });
});
