import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it, type TestContext } from "node:test";

import * as schema from "../src/db/schema";
import { loadRoute } from "./helpers/load-route";
import { localSql } from "./helpers/local-sql";

type ResolveRoute = {
  POST(req: Request, context: { params: Promise<{ id: string }> }): Promise<Response>;
};

function fixture(t: TestContext, options: { authenticated?: boolean; scoped?: boolean } = {}) {
  const sql = localSql({
    events: schema.events,
    rejection_log: schema.rejectionLog,
    learnings: schema.learnings,
  });
  t.after(() => sql.store.close());
  sql.store.exec(`INSERT INTO events (id,community_id,status,title) VALUES
    (40,3,'submitted','Original event'),
    (41,3,'pending','New-date proposal'),
    (42,3,'pending','Ordinary pending event'),
    (43,3,'approved','Proposal already approved'),
    (45,3,'pending','Cross-community proposal'),
    (60,4,'submitted','Foreign original')`);
  sql.store.exec(`UPDATE events SET proposed_update_of_event_id=40,
    rejection_reason='New recurrence dates require review; no update has been sent.' WHERE id IN (41,43)`);
  sql.store.exec("UPDATE events SET proposed_update_of_event_id=60 WHERE id=45");

  const helperFile = new URL("../src/lib/proposalResolution.ts", import.meta.url);
  assert.ok(existsSync(helperFile), "dedicated proposal resolution helper must exist");
  const helper = loadRoute<typeof import("../src/lib/proposalResolution")>(helperFile, {
    "server-only": {},
    "@/db": { db: sql.db },
    "@/db/schema": schema,
  });
  const routeFile = new URL("../src/app/api/events/[id]/resolve-proposal/route.ts", import.meta.url);
  assert.ok(existsSync(routeFile), "authenticated proposal resolution route must exist");
  const activity: Record<string, unknown>[] = [];
  const route = loadRoute<ResolveRoute>(routeFile, {
    "@/lib/auth": {
      getSession: async () => options.authenticated === false
        ? null
        : { uid: 7, email: "reviewer@example.test" },
    },
    "@/lib/data": {
      getEventScoped: async (_session: unknown, id: number) =>
        options.scoped === false ? null : { id, communityId: 3, title: "New-date proposal" },
    },
    "@/lib/proposalResolution": helper,
    "@/lib/activity": { logActivity: async (entry: Record<string, unknown>) => { activity.push(entry); } },
  });
  const call = (id = "41") => route.POST(
    new Request(`https://app.example.test/api/events/${id}/resolve-proposal`, { method: "POST" }),
    { params: Promise.resolve({ id }) },
  );
  return { ...sql, activity, call };
}

describe("reviewer proposal resolution", () => {
  for (const [name, options, expected] of [
    ["unauthenticated", { authenticated: false }, 401],
    ["foreign or unscoped", { scoped: false }, 404],
  ] as const) {
    it(`does not act for an ${name} request`, async (t) => {
      const f = fixture(t, options);
      assert.equal((await f.call()).status, expected);
      assert.equal(f.queries.length, 0);
      assert.equal(f.activity.length, 0);
    });
  }

  it("marks only a pending proposal resolved without rejection or learning", async (t) => {
    const f = fixture(t);
    const response = await f.call();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.eventId, 41);
    assert.equal(body.originalEventId, 40);
    assert.equal(body.alreadyResolved, false);
    assert.match(body.proposalResolvedAt, /^\d{4}-\d{2}-\d{2}T/);

    const proposal = f.store.prepare(`SELECT status,proposed_update_of_event_id,
      proposal_resolved_at,rejection_reason FROM events WHERE id=41`).get()!;
    assert.equal(proposal.status, "duplicate");
    assert.equal(proposal.proposed_update_of_event_id, 40);
    assert.ok(proposal.proposal_resolved_at);
    assert.match(String(proposal.rejection_reason), /New recurrence dates require review/);
    assert.equal(f.store.prepare("SELECT count(*) n FROM rejection_log").get()!.n, 0);
    assert.equal(f.store.prepare("SELECT count(*) n FROM learnings").get()!.n, 0);
    assert.equal(f.activity.length, 1);
    assert.deepEqual((f.activity[0].detail as Record<string, unknown>).command, "resolve_proposal");

    assert.equal(f.store.prepare("SELECT status FROM events WHERE id=40").get()!.status, "submitted");
    assert.equal(f.store.prepare("SELECT status FROM events WHERE id=42").get()!.status, "pending");
  });

  it("is idempotent and retains the first resolution timestamp", async (t) => {
    const f = fixture(t);
    assert.equal((await f.call()).status, 200);
    const first = f.store.prepare("SELECT proposal_resolved_at value FROM events WHERE id=41").get()!.value;
    const response = await f.call();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.alreadyResolved, true);
    assert.equal(f.store.prepare("SELECT proposal_resolved_at value FROM events WHERE id=41").get()!.value, first);
  });

  it("rejects ordinary events and proposals in a non-reviewable status", async (t) => {
    const f = fixture(t);
    assert.equal((await f.call("42")).status, 409);
    assert.equal((await f.call("43")).status, 409);
    assert.equal(f.store.prepare("SELECT status FROM events WHERE id=42").get()!.status, "pending");
    assert.equal(f.store.prepare("SELECT status FROM events WHERE id=43").get()!.status, "approved");
    assert.equal(f.activity.length, 0);
  });

  it("does not resolve a proposal whose original is outside the proposal community", async (t) => {
    const f = fixture(t);
    assert.equal((await f.call("45")).status, 409);
    const proposal = f.store.prepare("SELECT status,proposal_resolved_at FROM events WHERE id=45").get()!;
    assert.equal(proposal.status, "pending");
    assert.equal(proposal.proposal_resolved_at, null);
    assert.equal(f.activity.length, 0);
  });
});
