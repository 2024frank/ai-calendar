import assert from "node:assert/strict";
import { it } from "node:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "../src/db/schema";
import * as evaluation from "../src/lib/evaluation";
import * as requestBody from "../src/lib/requestBody";
import { loadRoute } from "./helpers/load-route";
import { fixture } from "./fixtures/evaluation";

type Collection = { GET(req: Request): Promise<Response>; POST(req: Request): Promise<Response> };
type Detail = { GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> };

function setup(role: string | null = "community_admin", communityId: number | null = 3) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes("from `sources`")) return { rows: params.includes(7) && params.includes(3) ? [[7]] : [] };
    if (sql.startsWith("insert")) return { rows: [{ insertId: 42 }] };
    if (sql.includes("from `evaluations`") && params.includes(999)) return { rows: [] };
    if (sql.includes("from `evaluations`") && sql.includes("`snapshot`")) {
      const input = evaluation.validateEvaluation(fixture());
      return { rows: [[42, 3, 7, null, { id: 9, email: "reviewer@example.test", name: "Reviewer" }, input.title, 1, input.period.start, input.period.end, input.provenance, input, input.matches, evaluation.compareEvaluation(input), "2026-09-05 00:00:00"]] };
    }
    return { rows: [] };
  });
  const deps = { "@/db": { db }, "@/db/schema": schema,
    "@/lib/auth": { getSession: async () => role ? ({ uid: 9, email: "reviewer@example.test", name: "Reviewer", role, communityId: 3 }) : null, isAdmin: (s: { role: string }) => s.role.endsWith("admin") },
    "@/lib/data": { currentCommunityId: async () => communityId },
    "@/lib/evaluation": evaluation, "@/lib/requestBody": requestBody,
  };
  return { queries,
    collection: () => loadRoute<Collection>(new URL("../src/app/api/evaluations/route.ts", import.meta.url), deps),
    detail: () => loadRoute<Detail>(new URL("../src/app/api/evaluations/[id]/route.ts", import.meta.url), deps),
  };
}
const request = (body: unknown) => new Request("https://calendar.test/api/evaluations", { method: "POST", body: JSON.stringify(body) });

it("retains normalized immutable evidence, human matches, creator and deterministic report", async () => {
  const app = setup(); const response = await app.collection().POST(request(fixture()));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).id, 42);
  const write = app.queries.find((q) => q.sql.startsWith("insert"))!;
  assert.ok(write.sql.includes("`evaluations`"));
  assert.ok(write.params.includes(9)); assert.ok(write.params.includes(3));
  assert.ok(write.params.some((p) => typeof p === "string" && p.includes('"referenceCoveragePct":50')));
  assert.ok(write.params.some((p) => typeof p === "string" && p.includes('"referenceId":"A"')));
  assert.ok(write.params.some((p) => typeof p === "string" && p.includes('"id":9') && p.includes('"email":"reviewer@example.test"')), "creator attribution must survive account deletion");
  assert.equal(app.queries.some((q) => /update|insert into `events`/.test(q.sql)), false);
});

for (const role of [null, "reviewer"]) it(`denies ${role ?? "anonymous"} create/list/detail/export without querying evidence`, async () => {
  const app = setup(role); const ctx = { params: Promise.resolve({ id: "42" }) };
  const routes = app.collection();
  assert.equal((await routes.POST(request(fixture()))).status, role ? 403 : 401);
  assert.equal((await routes.GET(new Request("https://calendar.test/api/evaluations"))).status, role ? 403 : 401);
  assert.equal((await app.detail().GET(new Request("https://calendar.test/api/evaluations/42?download=1"), ctx)).status, role ? 403 : 401);
  assert.equal(app.queries.length, 0);
});

it("rejects missing current community even for a platform admin", async () => {
  const app = setup("platform_admin", null);
  assert.equal((await app.collection().POST(request(fixture()))).status, 403);
  assert.equal((await app.collection().GET(new Request("https://calendar.test/api/evaluations"))).status, 403);
  assert.equal(app.queries.length, 0);
});

it("rejects foreign sources and scopes list/detail/export to the selected authorized community", async () => {
  const app = setup(); const f = fixture(); f.sourceId = 999;
  assert.equal((await app.collection().POST(request(f))).status, 404);
  assert.equal(app.queries.some((q) => q.sql.startsWith("insert")), false);
  const list = await app.collection().GET(new Request("https://calendar.test/api/evaluations"));
  assert.equal(list.status, 200);
  const detail = await app.detail().GET(new Request("https://calendar.test/api/evaluations/999?download=1"), { params: Promise.resolve({ id: "999" }) });
  assert.equal(detail.status, 404);
  for (const q of app.queries.filter((q) => q.sql.includes("from `evaluations`"))) {
    assert.match(q.sql, /where.*community_id/); assert.ok(q.params.includes(3));
  }
});

it("exports retained evidence with attachment headers and rejects malformed IDs", async () => {
  const app = setup();
  const response = await app.detail().GET(new Request("https://calendar.test/api/evaluations/42?download=1"), { params: Promise.resolve({ id: "42" }) });
  assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition")!, /attachment/);
  const body = await response.json(); assert.equal(body.snapshot.reference.length, 2); assert.equal(body.report.referenceCoveragePct, 50);
  assert.equal(body.createdBy, null);
  assert.equal(body.creator.email, "reviewer@example.test");
  const count = app.queries.length;
  assert.equal((await app.detail().GET(new Request("https://calendar.test/api/evaluations/no"), { params: Promise.resolve({ id: "no" }) })).status, 400);
  assert.equal(app.queries.length, count);
});

it("rejects malformed JSON, nonobjects, invalid snapshots and actual oversized bodies without writes", async () => {
  for (const body of ["{", "null", JSON.stringify({ bad: true }), JSON.stringify({ extra: "x".repeat(evaluation.MAX_EVALUATION_BYTES + 1) })]) {
    const app = setup();
    const response = await app.collection().POST(new Request("https://calendar.test/api/evaluations", { method: "POST", body }));
    assert.equal(response.status, body.length > evaluation.MAX_EVALUATION_BYTES ? 413 : 400);
    assert.equal(app.queries.some((q) => q.sql.startsWith("insert")), false);
  }
});
