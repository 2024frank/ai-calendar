import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "../src/db/schema";
import * as policy from "../src/lib/publishReconciliation";
import { loadRoute } from "./helpers/load-route";

describe("publication reconciliation lock order", () => {
  async function reconcile(outcome: string, exists = true, currentStatus = "pending", operation = "create", confirmedOperation = "create") {
    const queries: string[] = [];
    const db = drizzle(async (sql) => {
      queries.push(sql);
      if (sql.includes("from `events`")) return { rows: exists ? [[41, currentStatus]] : [] };
      if (sql.includes("from `publish_submissions`")) return { rows: [[12, "accepted_unreconciled", 7, "hash", "2026-01-01 00:00:00",operation]] };
      return { rows: [{ affectedRows: 1 }] };
    });
    Object.assign(db, { transaction: async (callback: (tx: typeof db) => unknown) => callback(db) });
    const { POST } = loadRoute<{ POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> }>(
      new URL("../src/app/api/events/[id]/reconcile-publish/route.ts", import.meta.url),
      {
        "@/db": { db }, "@/db/schema": schema,
        "@/lib/auth": { getSession: async () => ({ uid: 1, email: "reviewer@example.com" }) },
        "@/lib/data": { getEventScoped: async () => ({ id: 41, status: "pending", title: "Workshop" }) },
        "@/lib/activity": { logActivity: async () => undefined },
        "@/lib/publishReconciliation": policy,
      },
    );
    const response = await POST(new Request("https://calendar.example/api/events/41/reconcile-publish", {
      method: "POST", body: JSON.stringify({ outcome, operation: confirmedOperation }),
    }), { params: Promise.resolve({ id: "41" }) });
    return { response, queries };
  }

  for (const outcome of ["published", "not_published"]) {
    it(`locks the event before any submission operation when marking ${outcome}`, async () => {
      const { response, queries } = await reconcile(outcome);
      assert.equal(response.status, 200);
      assert.match(queries[0], /from `events`.*for update/);
      assert.match(queries[1], /from `publish_submissions`.*for update/);
    });
  }

  it("does not reconcile an event deleted after the initial access check", async () => {
    const { response, queries } = await reconcile("published", false);
    assert.equal(response.status, 409);
    assert.ok(!queries.some((query) => /^(update|insert) /i.test(query)));
  });

  it("uses the locked event status when withdrawing rejection lessons", async () => {
    const { response, queries } = await reconcile("published", true, "rejected");
    assert.equal(response.status, 200);
    assert.ok(queries.some((query) => query.startsWith("update `learnings`")));
  });
  it("reconciles an update without approving the post or withdrawing rejection lessons",async()=> {
    const {response,queries}=await reconcile("published",true,"submitted","update","update");
    assert.equal(response.status,200);
    assert.ok(!queries.some(q=>q.startsWith("update `events`") || q.startsWith("update `learnings`")));
    assert.equal((await response.json()).eventStatus,"submitted");
  });
  it("does not treat mere post existence as verification of updated content",async()=> {
    const {response,queries}=await reconcile("published",true,"submitted","update","create");
    assert.equal(response.status,409); assert.ok(!queries.some(q=>q.startsWith("update ")));
  });
});
