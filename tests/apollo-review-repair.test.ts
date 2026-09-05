import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { restoreApolloReview } from "../scripts/restore-apollo-review.mjs";

const SEP_10_2026_MIDNIGHT_EDT = 1_789_012_800;

type EventRow = {
  id: number;
  source_id: number;
  source_slug: string;
  community_slug: string;
  status: string;
  title: string;
  description: string;
  sessions: unknown;
  duplicate_of_event_id: number | null;
  duplicate_of_url: string | null;
  dedup_key: string | null;
  rejection_reason: string | null;
  field_notes: unknown;
  corrected_at: Date | null;
  published_via: string | null;
  source_mode: string | null;
  community_default_mode: string;
};

function validEvent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 1879,
    source_id: 18,
    source_slug: "apollo-theater",
    community_slug: "oberlin",
    status: "duplicate",
    title: "Coming Soon at the Apollo",
    description: "  Practical   Magic 2:   opens   Sep 10  ",
    sessions: [{ startTime: SEP_10_2026_MIDNIGHT_EDT, endTime: SEP_10_2026_MIDNIGHT_EDT + 86_399 }],
    duplicate_of_event_id: 1797,
    duplicate_of_url: null,
    dedup_key: "historical-dedup-evidence",
    rejection_reason: "historical duplicate decision",
    field_notes: { duplicate: "same shared ticket listing" },
    corrected_at: null,
    published_via: null,
    source_mode: "needs_approval",
    community_default_mode: "needs_approval",
    ...overrides,
  };
}

type Submission = { state: string; external_post_id: string | null };

class RecordingConnection {
  event: EventRow;
  submissions: Submission[];
  statements: { sql: string; params: unknown[] }[] = [];
  auditRows: unknown[][] = [];
  timeline: string[] = [];
  failAudit = false;
  began = 0;
  committed = 0;
  rolledBack = 0;

  constructor(event = validEvent(), submissions: Submission[] = []) {
    this.event = structuredClone(event);
    this.submissions = structuredClone(submissions);
  }

  async beginTransaction() {
    this.began += 1;
    this.timeline.push("BEGIN");
  }

  async commit() {
    this.committed += 1;
    this.timeline.push("COMMIT");
  }

  async rollback() {
    this.rolledBack += 1;
    this.timeline.push("ROLLBACK");
  }

  async execute(sql: string, params: unknown[] = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.statements.push({ sql: normalized, params });

    if (/^SELECT .* FROM events e /i.test(normalized)) {
      return [[structuredClone(this.event)], []];
    }
    if (/^SELECT .* FROM publish_submissions /i.test(normalized)) {
      return [structuredClone(this.submissions), []];
    }
    if (/^UPDATE events SET status = \?/i.test(normalized)) {
      this.timeline.push("UPDATE");
      this.event.status = String(params[0]);
      return [{ affectedRows: 1 }, []];
    }
    if (/^INSERT INTO activity_log /i.test(normalized)) {
      this.timeline.push("AUDIT");
      if (this.failAudit) throw new Error("audit unavailable");
      this.auditRows.push(structuredClone(params));
      return [{ affectedRows: 1, insertId: 91 }, []];
    }
    throw new Error(`Unexpected SQL: ${normalized}`);
  }
}

describe("bounded Apollo duplicate repair", () => {
  it("rejects an explicit environment path that is not a readable file", () => {
    const script = fileURLToPath(new URL("../scripts/restore-apollo-review.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, "--env", "/definitely/missing/apollo-repair.env"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /environment file/i);
  });

  it("defaults to a dry-run that locks and validates but rolls back without writes", async () => {
    const connection = new RecordingConnection();

    const result = await restoreApolloReview(connection);

    assert.deepEqual(result, {
      applied: false,
      eventId: 1879,
      previousStatus: "duplicate",
      status: "pending",
      reason: "confirmed Apollo rolling-lineup false duplicate against event 1797",
    });
    assert.equal(connection.began, 1);
    assert.equal(connection.committed, 0);
    assert.equal(connection.rolledBack, 1);
    assert.equal(connection.event.status, "duplicate");
    assert.equal(connection.auditRows.length, 0);
    assert.equal(connection.statements.some(({ sql }) => /^UPDATE |^INSERT /i.test(sql)), false);
  });

  it("atomically changes only status to pending and appends a system audit record", async () => {
    const before = validEvent();
    const connection = new RecordingConnection(before);

    const result = await restoreApolloReview(connection, { apply: true });

    assert.equal(result.applied, true);
    assert.equal(connection.began, 1);
    assert.equal(connection.committed, 1);
    assert.equal(connection.rolledBack, 0);
    assert.deepEqual(connection.event, { ...before, status: "pending" });

    const updates = connection.statements.filter(({ sql }) => /^UPDATE events /i.test(sql));
    assert.equal(updates.length, 1);
    assert.match(
      updates[0].sql,
      /^UPDATE events SET status = \? WHERE id = \? AND status = \? AND source_id = \? AND duplicate_of_event_id = \?$/i,
    );
    assert.deepEqual(updates[0].params, ["pending", 1879, "duplicate", 18, 1797]);

    assert.equal(connection.auditRows.length, 1);
    assert.deepEqual(connection.timeline, ["BEGIN", "UPDATE", "AUDIT", "COMMIT"]);
    const audit = connection.statements.find(({ sql }) => /^INSERT INTO activity_log /i.test(sql));
    assert.ok(audit);
    assert.match(audit.sql, /actor_user_id, actor_email, action, target_type, target_id, summary, detail/i);
    assert.equal(audit.params[0], null);
    assert.equal(audit.params[1], null);
    assert.equal(audit.params[2], "restore_review");
    assert.equal(audit.params[3], "event");
    assert.equal(audit.params[4], 1879);
    assert.match(String(audit.params[5]), /system maintenance/i);
    const detail = JSON.parse(String(audit.params[6]));
    assert.deepEqual(detail, {
      previousStatus: "duplicate",
      status: "pending",
      sourceId: 18,
      duplicateOfEventId: 1797,
      duplicateOfUrl: null,
      reason: "confirmed Apollo rolling-lineup false duplicate against event 1797",
    });
  });

  it("rolls back the status transition when its audit insert fails", async () => {
    const connection = new RecordingConnection();
    connection.failAudit = true;

    await assert.rejects(restoreApolloReview(connection, { apply: true }), /audit unavailable/);

    assert.equal(connection.committed, 0);
    assert.equal(connection.rolledBack, 1);
    assert.deepEqual(connection.timeline, ["BEGIN", "UPDATE", "AUDIT", "ROLLBACK"]);
  });

  it("rejects any record that is not the exact confirmed false match", async () => {
    const cases: [string, Partial<EventRow>][] = [
      ["event id", { id: 1880 }],
      ["source id", { source_id: 19 }],
      ["source slug", { source_slug: "apollo" }],
      ["community slug", { community_slug: "another-town" }],
      ["status", { status: "pending" }],
      ["duplicate reference", { duplicate_of_event_id: 1800 }],
      ["title", { title: "Playing Now at the Apollo" }],
      ["film description", { description: "Dog Stars and Coyote: opens Sep 10" }],
      ["opening date text", { description: "Practical Magic 2: opens Sep 11" }],
      ["session date", { sessions: [{ startTime: SEP_10_2026_MIDNIGHT_EDT + 86_400 }] }],
      ["effective review mode", { source_mode: "auto_send" }],
      ["effective review mode", { source_mode: null, community_default_mode: "auto_publish" }],
      ["publication marker", { published_via: "reviewer" }],
    ];

    for (const [name, override] of cases) {
      const connection = new RecordingConnection(validEvent(override));
      await assert.rejects(
        restoreApolloReview(connection, { apply: true }),
        new RegExp(name, "i"),
        name,
      );
      assert.equal(connection.committed, 0, name);
      assert.equal(connection.rolledBack, 1, name);
      assert.equal(connection.auditRows.length, 0, name);
    }
  });

  it("holds the repair for every non-failed submission or any stored external post id", async () => {
    for (const submission of [
      { state: "prepared", external_post_id: null },
      { state: "sending", external_post_id: null },
      { state: "succeeded", external_post_id: "5191" },
      { state: "accepted_unreconciled", external_post_id: null },
      { state: "failed", external_post_id: "5191" },
    ]) {
      const connection = new RecordingConnection(validEvent(), [submission]);
      await assert.rejects(
        restoreApolloReview(connection, { apply: true }),
        /publication evidence/i,
        JSON.stringify(submission),
      );
      assert.equal(connection.committed, 0);
      assert.equal(connection.rolledBack, 1);
    }
  });

  it("allows only failed submissions with no external post id", async () => {
    const connection = new RecordingConnection(validEvent(), [
      { state: "failed", external_post_id: null },
    ]);

    const result = await restoreApolloReview(connection, { apply: true });

    assert.equal(result.applied, true);
    assert.equal(connection.committed, 1);
  });
});
