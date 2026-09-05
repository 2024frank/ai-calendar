/** Opt-in only: a disposable loopback MySQL server, never the app's database. */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import mysql, { type Connection, type Pool } from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import { loadRoute } from "../helpers/load-route";
import * as reconciliationPolicy from "../../src/lib/publishReconciliation";
import type { Session } from "../../src/lib/auth";

const submitUrl = "https://original.example.org/api/legacy/calendar/post/submit";
const replacementUrl = "https://replacement.example.org/api/legacy/calendar/post/submit";
const databaseName = `ai_calendar_test_${randomUUID().replaceAll("-", "")}`;
let admin: Connection | undefined;
let firstPool: Pool | undefined;
let secondPool: Pool | undefined;
let first: MySql2Database;
let second: MySql2Database;
let created = false;

before(async () => {
  const raw = process.env.AI_CALENDAR_TEST_MYSQL_URL;
  if (!raw || process.env.AI_CALENDAR_ALLOW_TEST_DATABASE_CREATE !== "1") {
    throw new Error("Real MySQL tests require explicit AI_CALENDAR_TEST_MYSQL_URL and AI_CALENDAR_ALLOW_TEST_DATABASE_CREATE=1. App DATABASE_* variables and .env files are never used.");
  }
  const url = new URL(raw);
  if (url.protocol !== "mysql:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !["", "/"].includes(url.pathname) || url.search || url.hash) {
    throw new Error("Test URL must target a dedicated loopback MySQL server without a database, query, or fragment.");
  }
  const options = { host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), connectTimeout: 5000, timezone: "Z" };
  try { admin = await mysql.createConnection(options); }
  catch { throw new Error("Could not connect to the explicitly configured disposable MySQL server."); }
  // This identifier is generated here, never taken from an environment variable.
  assert.match(databaseName, /^ai_calendar_test_[a-f0-9]{32}$/);
  await admin.query(`CREATE DATABASE \`${databaseName}\``);
  created = true;
  firstPool = mysql.createPool({ ...options, database: databaseName, connectionLimit: 1 });
  secondPool = mysql.createPool({ ...options, database: databaseName, connectionLimit: 1 });
  first = drizzle(firstPool);
  second = drizzle(secondPool);
  await migrate(first, { migrationsFolder: "drizzle" });
  await first.insert(schema.communities).values({ id: 1, slug: "test-town", name: "Synthetic test town" });
  await first.insert(schema.communities).values({ id: 2, slug: "other-test-town", name: "Other synthetic town" });
  await first.insert(schema.users).values({ id: 200, communityId: 1, email: "reviewer@example.org", role: "reviewer" });
  await first.insert(schema.destinations).values({ id: 1, communityId: 1, name: "Synthetic destination", type: "communityhub", config: { submit_url: submitUrl } });
});

after(async () => {
  const closing = await Promise.allSettled([firstPool?.end(), secondPool?.end()]);
  const errors: unknown[] = closing.filter(result => result.status === "rejected").map(result => result.reason);
  try {
    if (admin && created && /^ai_calendar_test_[a-f0-9]{32}$/.test(databaseName)) {
      await admin.query(`DROP DATABASE \`${databaseName}\``);
    }
  } catch (error) { errors.push(error); }
  finally {
    try { await admin?.end(); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Disposable MySQL cleanup did not complete.");
});

type Claim = { kind: string; submissionId?: number };
function claims(db: typeof first) {
  return loadRoute<{ claimPublication(input: Record<string, unknown>): Promise<Claim> }>(new URL("../../src/lib/publishClaim.ts", import.meta.url), {
    "server-only": {}, "@/db": { db }, "@/db/schema": schema,
  }).claimPublication;
}

function correctionLease(db: typeof first) {
  return loadRoute<typeof import("../../src/lib/correctionLease")>(new URL("../../src/lib/correctionLease.ts", import.meta.url), {
    "server-only": {}, "@/db": { db }, "@/db/schema": schema,
  });
}

function retention(db: typeof first) {
  return loadRoute<typeof import("../../src/lib/retention")>(new URL("../../src/lib/retention.ts", import.meta.url), {
    "server-only": {}, "@/db": { db }, "@/db/schema": schema,
  });
}

const reviewer: Session = { uid: 200, email: "reviewer@example.org", name: "Synthetic reviewer", role: "reviewer", communityId: 1, canReviewAllSources: false };
function proposalRoute(db: typeof first, session: Session | null = reviewer) {
  const boundaries = { "server-only": {}, "@/db": { db }, "@/db/schema": schema };
  const resolution = loadRoute<typeof import("../../src/lib/proposalResolution")>(new URL("../../src/lib/proposalResolution.ts", import.meta.url), boundaries);
  const data = loadRoute<typeof import("../../src/lib/data")>(new URL("../../src/lib/data.ts", import.meta.url), {
    ...boundaries, "next/headers": { cookies: async () => ({ get: () => undefined }) },
  });
  const activity = loadRoute<typeof import("../../src/lib/activity")>(new URL("../../src/lib/activity.ts", import.meta.url), boundaries);
  // Only the cookie/session boundary is replaced; tenant queries, resolution,
  // row locks and audit writes all execute against the disposable MySQL DB.
  return loadRoute<typeof import("../../src/app/api/events/[id]/resolve-proposal/route")>(new URL("../../src/app/api/events/[id]/resolve-proposal/route.ts", import.meta.url), {
    "@/lib/auth": { getSession: async () => session },
    "@/lib/data": data, "@/lib/proposalResolution": resolution, "@/lib/activity": activity,
  });
}

function resolve(db: typeof first, id: number, session: Session | null = reviewer) {
  return proposalRoute(db, session).POST(new Request(`https://example.org/api/events/${id}/resolve-proposal`, { method: "POST" }), { params: Promise.resolve({ id: String(id) }) });
}

async function event(id: number) {
  await first.insert(schema.events).values({ id, communityId: 1, title: `Synthetic event ${id}` });
}

function input(eventId: number, operation = "create", title = "Synthetic content") {
  return { eventId, destinationId: 1, destinationSubmitUrl: submitUrl, payloadHash: randomUUID(), payload: { title }, operation };
}

describe("real MySQL publication isolation", { concurrency: false }, () => {
  it("applies the full migration chain to a fresh database with foreign keys", async () => {
    const [rows] = await firstPool!.query<mysql.RowDataPacket[]>("SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ?", [databaseName]);
    assert.ok(rows.some(row => row.TABLE_NAME === "evaluations"));
    assert.ok(rows.some(row => row.TABLE_NAME === "publish_submissions"));
    await assert.rejects(first.insert(schema.events).values({ communityId: 999999, title: "Invalid foreign key" }));
  });

  it("serializes two creates through independent database connections", async () => {
    await event(100);
    const outcomes = await Promise.all([claims(first)(input(100)), claims(second)(input(100))]);
    assert.deepEqual(outcomes.map(result => result.kind).sort(), ["claimed", "unresolved"]);
    const rows = await first.select().from(schema.publishSubmissions).where(eq(schema.publishSubmissions.eventId, 100));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "sending");
  });

  it("serializes simultaneous updates to a known post through actual row locks", async () => {
    await event(101);
    await first.insert(schema.publishSubmissions).values({ eventId: 101, destinationId: 1, destinationSubmitUrl: submitUrl, payloadHash: "original-101", operation: "create", state: "succeeded", externalPostId: "77", payload: { title: "Original" } });
    const outcomes = await Promise.all([claims(first)(input(101, "update", "Edit A")), claims(second)(input(101, "update", "Edit B"))]);
    assert.deepEqual(outcomes.map(result => result.kind).sort(), ["claimed", "unresolved"]);
    const rows = await first.select().from(schema.publishSubmissions).where(eq(schema.publishSubmissions.eventId, 101));
    assert.equal(rows.filter(row => row.state === "sending").length, 1);
    assert.equal(rows.length, 2);
  });

  it("does not reuse a stored post ID when the same destination row changes address", async () => {
    await event(102);
    await first.insert(schema.publishSubmissions).values({ eventId: 102, destinationId: 1, destinationSubmitUrl: submitUrl, payloadHash: "original-102", operation: "create", state: "succeeded", externalPostId: "78", payload: { title: "Original" } });
    await second.update(schema.destinations).set({ config: { submit_url: replacementUrl } }).where(eq(schema.destinations.id, 1));
    const outcome = await claims(first)({ ...input(102, "update", "Edited"), destinationSubmitUrl: replacementUrl });
    assert.equal(outcome.kind, "not_linked");
    assert.equal((await first.select().from(schema.publishSubmissions).where(eq(schema.publishSubmissions.eventId, 102))).length, 1);
  });

  it("preserves proposal anchors with a database foreign key", async () => {
    await event(103);
    await first.insert(schema.events).values({ id: 104, communityId: 1, title: "Future date proposal", proposedUpdateOfEventId: 103 });
    await assert.rejects(second.delete(schema.events).where(eq(schema.events.id, 103)));
    assert.equal((await first.select().from(schema.events).where(eq(schema.events.id, 103))).length, 1);
  });

  it("reconciles an uncertain update without racing a second send or changing moderation", async () => {
    await first.insert(schema.events).values({ id: 105, communityId: 1, status: "submitted", title: "Reconciliation fixture" });
    await first.insert(schema.publishSubmissions).values({ eventId: 105, destinationId: 1, destinationSubmitUrl: submitUrl, payloadHash: "uncertain-105", operation: "update", state: "accepted_unreconciled", externalPostId: "80", payload: { title: "Previously requested edit" } });
    const { POST } = loadRoute<typeof import("../../src/app/api/events/[id]/reconcile-publish/route")>(new URL("../../src/app/api/events/[id]/reconcile-publish/route.ts", import.meta.url), {
      "@/db": { db: first }, "@/db/schema": schema,
      "@/lib/auth": { getSession: async () => ({ uid: 1, email: "fixture@example.org" }) },
      "@/lib/data": { getEventScoped: async () => ({ id: 105, communityId: 1, status: "submitted", title: "Reconciliation fixture" }) },
      "@/lib/activity": { logActivity: async () => undefined },
      "@/lib/publishReconciliation": reconciliationPolicy,
    });
    const [response, claim] = await Promise.all([
      POST(new Request("https://example.org/api/events/105/reconcile-publish", { method: "POST", body: JSON.stringify({ outcome: "published", operation: "update" }) }), { params: Promise.resolve({ id: "105" }) }),
      claims(second)(input(105, "update", "Next edit")),
    ]);
    assert.equal(response.status, 200);
    assert.ok(["claimed", "unresolved"].includes(claim.kind));
    const rows = await first.select().from(schema.publishSubmissions).where(eq(schema.publishSubmissions.eventId, 105));
    assert.ok(rows.filter(row => row.state === "sending").length <= 1);
    assert.equal((await first.select().from(schema.events).where(eq(schema.events.id, 105)))[0].status, "submitted");
  });

  it("allows only one automatic or reviewer correction lease across independent connections", async () => {
    await first.insert(schema.events).values({ id: 106, communityId: 1, status: "auto_rejected", title: "Correction fixture" });
    const [automatic, reviewer] = await Promise.all([
      correctionLease(first).claimCorrection(106, 1, "Automatic correction", { automatic: true }),
      correctionLease(second).claimCorrection(106, 1, "Reviewer correction"),
    ]);
    assert.equal([automatic, reviewer].filter(Boolean).length, 1);
    const owner = automatic || reviewer;
    assert.ok(owner);
    await second.update(schema.events).set({ status: "rejected", rejectionReason: "A later human decision" }).where(eq(schema.events.id, 106));
    await assert.rejects(correctionLease(first).persistCorrection(owner, { description: "Late model output" }), /event changed/);
    await correctionLease(first).failCorrection(owner, "Could not apply late output", true);
    const [stored] = await first.select().from(schema.events).where(eq(schema.events.id, 106));
    assert.equal(stored.status, "rejected");
    assert.equal(stored.rejectionReason, "A later human decision");
    assert.equal(stored.description, null);
  });

  it("does not let a late correction overwrite an accepted manual edit", async () => {
    await event(107);
    const lease = await correctionLease(first).claimCorrection(107, 1, "Check description");
    assert.ok(lease);
    await second.update(schema.events).set({ description: "The reviewer's newer description" }).where(eq(schema.events.id, 107));
    await assert.rejects(correctionLease(first).persistCorrection(lease, { description: "Older model output" }), /event changed/);
    assert.equal((await first.select().from(schema.events).where(eq(schema.events.id, 107)))[0].description, "The reviewer's newer description");
  });
});

describe("real MySQL proposal retention and resolution", { concurrency: false }, () => {
  const now = Date.parse("2026-09-05T12:00:00Z");
  const expired = 1788264000; // September 1, 2026, noon UTC.
  const future = 1789041600; // September 10, 2026, noon UTC.
  const oldCreated = new Date("2026-01-01T00:00:00Z");

  it("executes the locking retention join and keeps both resolved and unresolved proposal parents", async () => {
    await first.insert(schema.events).values([
      { id: 200, communityId: 1, title: "Unresolved original", status: "submitted", startTimeMax: expired },
      { id: 202, communityId: 1, title: "Resolved original", status: "submitted", startTimeMax: expired },
      { id: 204, communityId: 1, title: "Unreferenced expired event", startTimeMax: expired },
    ]);
    await first.insert(schema.events).values([
      { id: 201, communityId: 1, title: "Pending proposal", startTimeMax: future, proposedUpdateOfEventId: 200 },
      { id: 203, communityId: 1, title: "Resolved proposal", status: "duplicate", startTimeMax: future, proposedUpdateOfEventId: 202, proposalResolvedAt: new Date("2026-09-04T12:00:00Z") },
    ]);
    const ids = async () => (await first.select({ id: schema.events.id }).from(schema.events).where(inArray(schema.events.id, [200, 201, 202, 203, 204])).orderBy(schema.events.id)).map(row => row.id);
    assert.equal(await retention(first).sweepExpiredEvents(now), 1);
    assert.deepEqual(await ids(), [200, 201, 202, 203]);
    await second.update(schema.events).set({ startTimeMax: expired }).where(inArray(schema.events.id, [201, 203]));
    assert.equal(await retention(first).sweepExpiredEvents(now), 2);
    assert.deepEqual(await ids(), [200, 202], "the final child leaves before its original, avoiding FK violations");
    assert.equal(await retention(first).sweepExpiredEvents(now), 2);
    assert.deepEqual(await ids(), []);
  });

  it("protects a dateless original from the age sweep while removing an unreferenced leftover", async () => {
    await first.insert(schema.events).values([
      { id: 210, communityId: 1, title: "Referenced dateless original", status: "duplicate", createdAt: oldCreated },
      { id: 212, communityId: 1, title: "Unreferenced dateless leftover", status: "auto_rejected", createdAt: oldCreated },
    ]);
    await first.insert(schema.events).values({ id: 211, communityId: 1, title: "Future proposal", startTimeMax: future, proposedUpdateOfEventId: 210 });
    assert.equal(await retention(first).sweepExpiredEvents(now), 1);
    const rows = await first.select({ id: schema.events.id }).from(schema.events).where(inArray(schema.events.id, [210, 211, 212])).orderBy(schema.events.id);
    assert.deepEqual(rows.map(row => row.id), [210, 211]);
  });

  it("serializes proposal resolution and records bookkeeping without teaching a rejection", async () => {
    await first.insert(schema.events).values({ id: 220, communityId: 1, title: "Published original", status: "submitted" });
    await first.insert(schema.events).values({ id: 221, communityId: 1, title: "New-date proposal", proposedUpdateOfEventId: 220, rejectionReason: "New recurrence dates require review." });
    const responses = await Promise.all([resolve(first, 221), resolve(second, 221)]);
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    const results = await Promise.all(responses.map(response => response.json()));
    assert.deepEqual(results.map(result => result.alreadyResolved).sort(), [false, true]);
    const [stored] = await first.select().from(schema.events).where(eq(schema.events.id, 221));
    assert.equal(stored.status, "duplicate");
    assert.equal(stored.proposedUpdateOfEventId, 220);
    assert.ok(stored.proposalResolvedAt);
    assert.equal(stored.rejectionReason, "New recurrence dates require review.");
    assert.equal((await first.select().from(schema.events).where(eq(schema.events.id, 220)))[0].status, "submitted");
    assert.equal((await first.select().from(schema.rejectionLog)).length, 0);
    assert.equal((await first.select().from(schema.learnings)).length, 0);
    const audit = await first.select().from(schema.activityLog).where(eq(schema.activityLog.targetId, 221));
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "edit");
    assert.equal((audit[0].detail as { command: string }).command, "resolve_proposal");
    const repeated = await resolve(first, 221);
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).proposalResolvedAt, stored.proposalResolvedAt.toISOString());
  });

  it("enforces actual community access and rejects a cross-community original", async () => {
    await first.insert(schema.events).values({ id: 223, communityId: 2, title: "Other community original", status: "submitted" });
    await first.insert(schema.events).values([
      { id: 224, communityId: 2, title: "Other community proposal", proposedUpdateOfEventId: 223 },
      { id: 225, communityId: 1, title: "Invalid cross-community proposal", proposedUpdateOfEventId: 223 },
    ]);
    assert.equal((await resolve(first, 224)).status, 404);
    assert.equal((await resolve(first, 225)).status, 409);
    assert.equal((await resolve(first, 225, null)).status, 401);
    const rows = await first.select().from(schema.events).where(inArray(schema.events.id, [224, 225]));
    assert.ok(rows.every(row => row.status === "pending" && row.proposalResolvedAt === null));
    assert.equal((await first.select().from(schema.activityLog).where(inArray(schema.activityLog.targetId, [224, 225]))).length, 0);
  });
});
