import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "../src/db/schema";
import { loadRoute } from "./helpers/load-route";

describe("pending event feed access", () => {
  async function request(query: string, liveCommunityId: number | null) {
    const queries: { sql: string; params: unknown[] }[] = [];
    const db = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("from `runs`")) {
        return { rows: liveCommunityId === null ? [] : [[liveCommunityId]] };
      }
      if (sql.includes("count(*)")) return { rows: [[0]] };
      return { rows: [] };
    });
    const { GET } = loadRoute<{ GET(req: Request): Promise<Response> }>(
      new URL("../src/app/api/public/events/route.ts", import.meta.url),
      {
        "@/db": { db }, "@/db/schema": schema,
        "@/lib/agentToken": { verifyRunToken: (_id: number, token: string) => token === "valid" },
      },
    );
    const response = await GET(new Request(`https://calendar.example/api/public/events?${query}`));
    return { response, queries };
  }

  it("rejects pending access from a valid HMAC whose run is missing or finished", async () => {
    const { response } = await request("status=pending&runId=19&token=valid", null);
    assert.equal(response.status, 400);
  });

  it("binds pending event queries to the live run's community", async () => {
    const { response, queries } = await request("status=all&runId=19&token=valid", 7);
    assert.equal(response.status, 200);
    const authorization = queries.find((q) => q.sql.includes("from `runs`"));
    assert.ok(authorization, "pending access must consult the current run");
    assert.match(authorization.sql, /`runs`\.`status` = \?/);
    assert.ok(authorization.params.includes("running"));
    assert.match(authorization.sql, /`runs`\.`finished_at` is null/);
    for (const query of queries.filter((q) => q.sql.includes("from `events`"))) {
      assert.match(query.sql, /`events`\.`community_id` = \?/);
      assert.ok(query.params.includes(7), "scope must come from the run, not request filters");
    }
  });

  it("keeps authenticated pending responses out of shared caches", async () => {
    const { response } = await request("status=pending&runId=19&token=valid", 7);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });

  it("keeps ordinary accepted-event feeds public and never queries pending", async () => {
    const { response, queries } = await request("status=all", null);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /^public,/);
    assert.ok(queries.every((q) => !q.params.includes("pending")));
  });
});
