/** Real MySQL + real loopback HTTP. Never reads .env, app DB configuration, or real destination credentials. */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { randomUUID } from "node:crypto";
import mysql, { type Connection, type Pool } from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import type { Session } from "../../src/lib/auth";
import { startTestDestination } from "../../scripts/test-destination.mjs";
import { loadRoute } from "../helpers/load-route";
import { syntheticPublicationTransport } from "../helpers/synthetic-publication-transport";

const submitUrl = "https://synthetic-publisher.example.test/api/legacy/calendar/post/submit";
const databaseName = `ai_calendar_test_${randomUUID().replaceAll("-", "")}`;
const reviewer: Session = { uid: 200, email: "synthetic-reviewer@example.test", name: "Synthetic reviewer", role: "reviewer", communityId: 1, canReviewAllSources: false };
const environment = { APP_URL: "https://synthetic-calendar.example.test", PUBLISH_EMAIL: "synthetic-publisher@example.test", AGENT_INGEST_SECRET: "synthetic-integration-signing-secret-not-for-production" };
const previousEnvironment = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
let admin: Connection | undefined;
let pool: Pool | undefined;
let db: MySql2Database;
let created = false;
let receiver: Awaited<ReturnType<typeof startTestDestination>> | undefined;
type PostRoute = { POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> };
let handlers: (session?: Session | null) => { approve: PostRoute; update: PostRoute; reconcile: PostRoute };

before(async () => {
  const raw = process.env.AI_CALENDAR_TEST_MYSQL_URL;
  if (!raw || process.env.AI_CALENDAR_ALLOW_TEST_DATABASE_CREATE !== "1") {
    throw new Error("Real HTTP publication tests require explicit AI_CALENDAR_TEST_MYSQL_URL and AI_CALENDAR_ALLOW_TEST_DATABASE_CREATE=1. App DATABASE_* variables and .env files are never used.");
  }
  const url = new URL(raw);
  if (url.protocol !== "mysql:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !["", "/"].includes(url.pathname) || url.search || url.hash) {
    throw new Error("Test URL must target a dedicated loopback MySQL server without a database, query, or fragment.");
  }
  const options = { host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), connectTimeout: 5000, timezone: "Z" };
  try { admin = await mysql.createConnection(options); }
  catch { throw new Error("Could not connect to the explicitly configured disposable MySQL server."); }
  assert.match(databaseName, /^ai_calendar_test_[a-f0-9]{32}$/);
  await admin.query(`CREATE DATABASE \`${databaseName}\``);
  created = true;
  pool = mysql.createPool({ ...options, database: databaseName, connectionLimit: 2 });
  db = drizzle(pool);
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.insert(schema.communities).values([
    { id: 1, slug: "synthetic-http-town", name: "Synthetic HTTP town", defaultDestinationId: 1 },
    { id: 2, slug: "other-synthetic-town", name: "Other synthetic town" },
  ]);
  await db.insert(schema.users).values({ id: reviewer.uid, communityId: 1, email: reviewer.email, role: "reviewer" });
  await db.insert(schema.destinations).values({ id: 1, communityId: 1, name: "Synthetic loopback receiver", type: "communityhub", config: { submit_url: submitUrl } });
  await db.insert(schema.sources).values({ id: 1, communityId: 1, name: "Synthetic arts source", slug: "synthetic-arts", destinationId: 1 });
  receiver = await startTestDestination();
  for (const [key, value] of Object.entries(environment)) process.env[key] = value;

  const bounds = { "server-only": {}, "@/db": { db }, "@/db/schema": schema };
  const transport = syntheticPublicationTransport(receiver.baseUrl);
  const reader = loadRoute<typeof import("../../src/lib/fetchPage")>(new URL("../../src/lib/fetchPage.ts", import.meta.url), { "server-only": {}, "./publicUrl": transport });
  const destination = loadRoute<typeof import("../../src/lib/destination")>(new URL("../../src/lib/destination.ts", import.meta.url), bounds);
  const claim = loadRoute<typeof import("../../src/lib/publishClaim")>(new URL("../../src/lib/publishClaim.ts", import.meta.url), bounds);
  const imageToken = loadRoute<typeof import("../../src/lib/imagePublishToken")>(new URL("../../src/lib/imagePublishToken.ts", import.meta.url), { "server-only": {} });
  const publishBounds = {
    ...bounds, "./publicUrl": transport, "./fetchPage": reader, "./destination": destination,
    "./publishClaim": claim, "./imagePublishToken": imageToken,
    // Images are synthetic bytes already stored in the scratch DB. Any attempt
    // to download an image is a test failure, never a route to outbound traffic.
    "./inlineImage": { inlineRemoteImage: async () => { throw new Error("Synthetic HTTP test prohibits remote image downloads."); }, INLINE_IMAGE_FAILURE_TEXT: {} },
  };
  const publication = loadRoute<typeof import("../../src/lib/publishEvent")>(new URL("../../src/lib/publishEvent.ts", import.meta.url), publishBounds);
  const update = loadRoute<typeof import("../../src/lib/publishUpdate")>(new URL("../../src/lib/publishUpdate.ts", import.meta.url), { ...publishBounds, "./publishEvent": publication });
  const data = loadRoute<typeof import("../../src/lib/data")>(new URL("../../src/lib/data.ts", import.meta.url), {
    ...bounds, "next/headers": { cookies: async () => ({ get: () => undefined }) },
  });
  const activity = loadRoute<typeof import("../../src/lib/activity")>(new URL("../../src/lib/activity.ts", import.meta.url), bounds);
  handlers = (session = reviewer) => {
    // Only cookie/session and the exact test transport boundary are synthetic.
    // Real tenant/source queries, destination selection, validation, outbox
    // locks, body parsing, publishing, reconciliation and audit writes execute.
    const routes = { ...bounds, "@/lib/auth": { getSession: async () => session }, "@/lib/data": data, "@/lib/activity": activity, "@/lib/publishEvent": publication, "@/lib/publishUpdate": update };
    return {
      approve: loadRoute<PostRoute>(new URL("../../src/app/api/events/[id]/approve/route.ts", import.meta.url), routes),
      update: loadRoute<PostRoute>(new URL("../../src/app/api/events/[id]/update-published/route.ts", import.meta.url), routes),
      reconcile: loadRoute<PostRoute>(new URL("../../src/app/api/events/[id]/reconcile-publish/route.ts", import.meta.url), routes),
    };
  };
}, { timeout: 30_000 });

after(async () => {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const closing = await Promise.allSettled([pool?.end(), receiver?.close()]);
  const errors: unknown[] = closing.filter(result => result.status === "rejected").map(result => result.reason);
  try {
    if (admin && created && /^ai_calendar_test_[a-f0-9]{32}$/.test(databaseName)) await admin.query(`DROP DATABASE \`${databaseName}\``);
  } catch (error) { errors.push(error); }
  finally { try { await admin?.end(); } catch (error) { errors.push(error); } }
  if (errors.length) throw new AggregateError(errors, "Synthetic HTTP publication cleanup did not complete.");
}, { timeout: 15_000 });

async function seedEvent(id: number, communityId = 1) {
  await db.insert(schema.events).values({
    id, communityId, sourceId: communityId === 1 ? 1 : null, title: "[SYNTHETIC TEST] Arts workshop",
    description: "Practice drawing in this entirely synthetic community workshop.", eventType: "ot", locationType: "ne", displayType: "all",
    sessions: [{ startTime: 2000000000, endTime: 2000003600 }], sponsors: ["Synthetic arts center"], postTypeIds: [89],
    imageData: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC5kAAAAASUVORK5CYII=",
    website: "https://synthetic-arts.example.test/workshop", contactEmail: "synthetic-events@example.test", phone: "202-555-0100",
  });
}
function call(route: PostRoute, id: number, body?: unknown) {
  return route.POST(new Request(`https://synthetic-calendar.example.test/api/events/${id}/command`, {
    method: "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { params: Promise.resolve({ id: String(id) }) });
}
async function inspection() {
  const response = await fetch(`${receiver!.baseUrl}/__synthetic__/posts`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  return await response.json() as { synthetic: boolean; acceptedRequests: number; posts: { id: number; payload: Record<string, unknown> }[]; requests: { method: string; id: number }[] };
}
async function event(id: number) { return (await db.select().from(schema.events).where(eq(schema.events.id, id)))[0]; }
async function submissions(id: number) { return db.select().from(schema.publishSubmissions).where(eq(schema.publishSubmissions.eventId, id)).orderBy(schema.publishSubmissions.id); }

describe("real MySQL publication through the isolated synthetic HTTP receiver", { concurrency: false, timeout: 30_000 }, () => {
  it("creates once, edits the same post, preserves remote and local moderation, and skips unchanged edits", async () => {
    await seedEvent(100);
    const route = handlers();
    const first = await call(route.approve, 100);
    assert.equal(first.status, 200, JSON.stringify(await first.json()));
    assert.equal((await call(route.approve, 100)).status, 200);
    let state = await inspection();
    assert.equal(state.synthetic, true);
    assert.equal(state.posts.length, 1);
    assert.equal(state.acceptedRequests, 1);
    assert.equal(state.posts[0].id, 1);
    assert.equal((await event(100)).status, "approved");
    assert.deepEqual((await submissions(100)).map(row => [row.operation, row.state, row.externalPostId, row.destinationSubmitUrl]), [["create", "succeeded", "1", submitUrl]]);

    // Simulate an independent moderator on the synthetic destination. This
    // makes accidental re-sending of public/subscribe/email observable.
    assert.equal((await fetch(`${receiver!.baseUrl}/api/legacy/calendar/post/1/submit`, {
      method: "PATCH", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ public: "0", subscribe: false, email: "synthetic-moderator@example.test" }),
    })).status, 200);
    await db.update(schema.events).set({ status: "submitted", title: "[SYNTHETIC TEST] Revised arts workshop" }).where(eq(schema.events.id, 100));
    const edited = await call(route.update, 100, { remoteId: "999", destination: "https://forbidden.example.org", public: "1" });
    assert.equal(edited.status, 200, JSON.stringify(await edited.json()));
    state = await inspection();
    assert.equal(state.posts.length, 1);
    assert.equal(state.posts[0].id, 1);
    assert.equal(state.posts[0].payload.title, "[SYNTHETIC TEST] Revised arts workshop");
    assert.equal(state.posts[0].payload.public, "0");
    assert.equal(state.posts[0].payload.subscribe, false);
    assert.equal(state.posts[0].payload.email, "synthetic-moderator@example.test");
    assert.equal((await event(100)).status, "submitted");
    assert.deepEqual((await submissions(100)).map(row => [row.operation, row.state, row.externalPostId]), [["create", "succeeded", "1"], ["update", "succeeded", "1"]]);
    assert.equal((await call(route.update, 100)).status, 200);
    assert.equal((await inspection()).acceptedRequests, 3);
    assert.equal((await submissions(100)).length, 2);
    const audit = await db.select().from(schema.activityLog).where(eq(schema.activityLog.targetId, 100));
    assert.ok(audit.some(row => row.action === "approve"));
    assert.ok(audit.some(row => (row.detail as { command?: string })?.command === "update_published"));
  });

  it("holds an ambiguously acknowledged real HTTP update until explicit reconciliation without resending", async () => {
    const route = handlers();
    await seedEvent(103);
    assert.equal((await call(route.approve, 103)).status, 200);
    const remoteId = Number((await submissions(103))[0].externalPostId);
    const post = async () => (await inspection()).posts.find(row => row.id === remoteId)!;
    assert.equal((await fetch(`${receiver!.baseUrl}/api/legacy/calendar/post/${remoteId}/submit`, {
      method: "PATCH", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(5000), body: JSON.stringify({ public: "0", subscribe: false }),
    })).status, 200);
    await db.update(schema.events).set({ status: "submitted", description: "Explore painting in this revised, entirely synthetic arts workshop." }).where(eq(schema.events.id, 103));
    const before = (await inspection()).acceptedRequests;
    receiver!.setNextAcknowledgment("ambiguous");
    const uncertain = await call(route.update, 103);
    assert.equal(uncertain.status, 409);
    assert.equal((await uncertain.json()).publish, "unknown");
    assert.equal((await submissions(103)).at(-1)!.state, "accepted_unreconciled");
    assert.equal((await post()).payload.description, "Explore painting in this revised, entirely synthetic arts workshop.");
    assert.equal((await call(route.update, 103)).status, 409);
    assert.equal((await inspection()).acceptedRequests, before + 1);
    assert.equal((await call(route.reconcile, 103, { outcome: "published" })).status, 409);
    const reconciled = await call(route.reconcile, 103, { outcome: "published", operation: "update" });
    assert.equal(reconciled.status, 200, JSON.stringify(await reconciled.json()));
    assert.equal((await submissions(103)).at(-1)!.state, "succeeded");
    assert.equal((await event(103)).status, "submitted");
    assert.equal((await call(route.update, 103)).status, 200);
    const state = await inspection();
    assert.equal(state.acceptedRequests, before + 1);
    assert.equal(state.requests.filter(row => row.method === "POST" && row.id === remoteId).length, 1);
    assert.equal((await post()).payload.public, "0");
    assert.equal((await post()).payload.subscribe, false);
  });

  it("does not mark an ambiguous create approved or send it again", async () => {
    await seedEvent(101);
    const before = (await inspection()).acceptedRequests;
    receiver!.setNextAcknowledgment("ambiguous");
    assert.equal((await call(handlers().approve, 101)).status, 409);
    assert.equal((await event(101)).status, "pending");
    const rows = await submissions(101);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "accepted_unreconciled");
    assert.equal(rows[0].externalPostId, null);
    assert.equal((await call(handlers().approve, 101)).status, 409);
    assert.equal((await inspection()).acceptedRequests, before + 1);
  });

  it("enforces actual tenant scoping and an authenticated session before publication", async () => {
    await seedEvent(102, 2);
    const before = (await inspection()).acceptedRequests;
    const signedOut = handlers(null);
    for (const route of [signedOut.approve, signedOut.update, signedOut.reconcile]) assert.equal((await call(route, 100)).status, 401);
    const scoped = handlers();
    for (const route of [scoped.approve, scoped.update, scoped.reconcile]) assert.equal((await call(route, 102)).status, 404);
    assert.equal((await submissions(102)).length, 0);
    assert.equal((await inspection()).acceptedRequests, before);
  });
});
