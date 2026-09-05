import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "../src/db/schema";
import { humanizeIssues } from "../src/lib/taxonomy";
import { loadRoute } from "./helpers/load-route";

type PublishResult = { ok: boolean; state: "succeeded" | "failed" | "unknown" | "skipped"; message: string; remoteId?: string };
type ApproveRoute = { POST(req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> };

function setup(status: string, publishResult: PublishResult, sessionPresent = true) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const publications: { id: number; status: string }[] = [];
  const activity: unknown[] = [];
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    return { rows: sql.includes("count(*)") ? [[2]] : [{ insertId: 0, affectedRows: 1 }] };
  });
  const route = loadRoute<ApproveRoute>(new URL("../src/app/api/events/[id]/approve/route.ts", import.meta.url), {
    "@/db": { db },
    "@/db/schema": schema,
    "@/lib/auth": { getSession: async () => sessionPresent ? { uid: 2, email: "reviewer@example.test", role: "reviewer" } : null },
    "@/lib/data": { getEventScoped: async () => ({ id: 41, title: "Community music", status }) },
    "@/lib/publishEvent": { publishEvent: async (id: number, finalStatus: string) => {
      publications.push({ id, status: finalStatus });
      return publishResult;
    } },
    "@/lib/activity": { logActivity: async (entry: unknown) => { activity.push(entry); } },
  });
  return { queries, publications, activity, call: () => route.POST(new Request("https://calendar.example/api/events/41/approve", { method: "POST" }), { params: Promise.resolve({ id: "41" }) }) };
}

describe("approval results preserve the actual event state", () => {
  for (const status of ["pending", "approved", "submitted", "published", "rejected", "auto_rejected"]) {
    it(`keeps ${status} and reports a conflict when an earlier accepted post has unsent edits`, async () => {
      const app = setup(status, { ok: false, state: "skipped", message: "This event was already sent. Review the existing CommunityHub post before publishing changes.", remoteId: "5191" });
      const response = await app.call();
      const body = await response.json();
      assert.equal(response.status, 409);
      assert.equal(body.ok, false);
      assert.equal(body.status, status);
      assert.equal(body.publish, "skipped");
      assert.match(body.error, /already sent/);
      assert.ok(body.error.includes(`${status.replaceAll("_", " ")} status`));
      assert.doesNotMatch(body.error, /NOT been approved|still waiting/);
      assert.equal(app.queries.length, 0, "failure must not alter status or retire rejection lessons");
      assert.equal(app.activity.length, 0, "failure must not log successful approval");
      assert.deepEqual(app.publications, [{ id: 41, status: "approved" }]);
    });
  }

  it("reports uncertain previous delivery as a conflict requiring reconciliation", async () => {
    const app = setup("pending", { ok: false, state: "unknown", message: "A previous send is unresolved. Reconcile it in CommunityHub before retrying." });
    const response = await app.call();
    assert.equal(response.status, 409);
    assert.equal((await response.json()).publish, "unknown");
    assert.equal(app.queries.length, 0);
  });

  it("reports a failed delivery separately from a publishing conflict", async () => {
    const app = setup("rejected", { ok: false, state: "failed", message: "CommunityHub rejected the request." });
    const response = await app.call();
    assert.equal(response.status, 502);
    assert.equal((await response.json()).status, "rejected");
    assert.equal(app.queries.length, 0);
  });

  it("still approves locally when there is intentionally no destination", async () => {
    const app = setup("pending", { ok: true, state: "skipped", message: "No endpoint configured; kept in the AI calendar." });
    const response = await app.call();
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "approved");
    assert.equal(body.publish, "skipped");
    assert.ok(app.queries.some((query) => query.sql.startsWith("update `events`") && query.params.includes("approved")));
    assert.equal(app.activity.length, 1);
  });

  it("retires rejection lessons only after successful approval", async () => {
    const app = setup("rejected", { ok: true, state: "succeeded", message: "Sent to CommunityHub." });
    const response = await app.call();
    assert.equal(response.status, 200);
    assert.ok(app.queries.some((query) => query.sql.startsWith("update `learnings`") && query.params.includes("retired")));
    assert.equal(app.activity.length, 2);
  });

  it("does not start approval for an unauthenticated request", async () => {
    const app = setup("pending", { ok: true, state: "succeeded", message: "Sent." }, false);
    const response = await app.call();
    assert.equal(response.status, 401);
    assert.equal(app.publications.length, 0);
    assert.equal(app.queries.length, 0);
  });
});

it("tells reviewers what to do when destination duplicate checking was unavailable", () => {
  const issues = humanizeIssues("Missing before publish: destination_inventory_unavailable, image_missing");
  assert.match(issues[0], /check for an existing copy before approving/);
  assert.doesNotMatch(issues[0], /destination_inventory_unavailable/);
  assert.equal(issues[1], "No picture was found for this event");
});
