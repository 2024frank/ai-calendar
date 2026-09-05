import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as schema from "../src/db/schema";
import { isPublicHttpUrl } from "../src/lib/publicUrl";
import * as schedule from "../src/lib/schedule";
import * as modeLabels from "../src/lib/modeLabels";
import * as time from "../src/lib/time";
import { loadRoute } from "./helpers/load-route";

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

function fixture(activeCommunityId: number | null = 8) {
  const writes: { table: unknown; values: Record<string, unknown> }[] = [];
  const db = {
    select() {
      let table: unknown;
      const query = {
        from(value: unknown) { table = value; return query; },
        where: () => query,
        limit: async () => table === schema.destinations ? [{ id: 20 }] : [],
      };
      return query;
    },
    insert(table: unknown) {
      return { values: async (values: Record<string, unknown>) => {
        writes.push({ table, values });
        return [{ insertId: 100 }];
      } };
    },
    update(table: unknown) {
      return { set: (values: Record<string, unknown>) => ({ where: async () => {
        writes.push({ table, values });
        return [{ affectedRows: 1 }];
      } }) };
    },
  };
  const session = { uid: 1, email: "admin@example.com", role: "community_admin", communityId: 7 };
  const dependencies = {
    "@/db": { db }, "@/db/schema": schema,
    "@/lib/auth": { getSession: async () => session, isAdmin: () => true },
    "@/lib/data": {
      currentCommunityId: async () => activeCommunityId,
      accessibleCommunities: async () => [{ id: 7 }, { id: 8 }],
    },
    "@/lib/activity": { logActivity: async () => undefined },
    "@/lib/publicUrl": { isPublicHttpUrl, assertPublicHttpUrl: async () => undefined },
    "@/lib/schedule": schedule,
    "@/lib/modeLabels": modeLabels,
    "@/lib/time": time,
    "@/lib/autoPublish": { flushCommunityInheritors: async () => ({ published: 0 }) },
  };
  return { writes, dependencies };
}

describe("community-admin source creation", () => {
  it("creates in the selected membership, ignoring an unrelated client tenant ID", async () => {
    const { writes, dependencies } = fixture();
    const { POST } = loadRoute<{ POST(req: Request): Promise<Response> }>(
      new URL("../src/app/api/sources/route.ts", import.meta.url), dependencies,
    );
    const response = await POST(new Request("https://calendar.example/api/sources", {
      method: "POST", body: JSON.stringify({ name: "Library", url: "https://library.example/events", communityId: 999 }),
    }));
    assert.equal(response.status, 200);
    assert.equal(writes.find((w) => w.table === schema.sources)?.values.communityId, 8);
  });

  it("does not fall back to the home community when no active membership is available", async () => {
    const { writes, dependencies } = fixture(null);
    const { POST } = loadRoute<{ POST(req: Request): Promise<Response> }>(
      new URL("../src/app/api/sources/route.ts", import.meta.url), dependencies,
    );
    const response = await POST(new Request("https://calendar.example/api/sources", {
      method: "POST", body: JSON.stringify({ name: "Library", url: "https://library.example/events" }),
    }));
    assert.equal(response.status, 400);
    assert.equal(writes.length, 0);
  });
});

for (const endpoint of [
  { file: "../src/app/api/communities/[id]/route.ts", method: "PATCH", body: { name: "Second community" } },
  { file: "../src/app/api/communities/[id]/endpoint/route.ts", method: "PUT", body: { apiBase: "https://hub.example", active: false } },
]) {
  describe(`community membership authorization: ${endpoint.method}`, () => {
    for (const { id, status } of [{ id: 8, status: 200 }, { id: 999, status: 403 }]) {
      it(id === 8 ? "permits an additional assigned community" : "refuses an unassigned community", async () => {
        const { writes, dependencies } = fixture();
        const route = loadRoute<Record<string, Handler>>(new URL(endpoint.file, import.meta.url), dependencies);
        const response = await route[endpoint.method](new Request(`https://calendar.example/api/communities/${id}`, {
          method: endpoint.method, body: JSON.stringify(endpoint.body),
        }), { params: Promise.resolve({ id: String(id) }) });
        assert.equal(response.status, status);
        assert.equal(writes.length > 0, status === 200);
      });
    }
  });
}
