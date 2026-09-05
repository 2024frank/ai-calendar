import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "../src/db/schema";
import { loadRoute } from "./helpers/load-route";

describe("event-wide publishing claim", () => {
  async function claim(prior: unknown[][]) {
    const queries: { sql: string; params: unknown[] }[] = [];
    const db = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes("from `events`")) return { rows: [[41]] };
      if (sql.includes("from `publish_submissions`")) {
        const hashFiltered = sql.split(" where ")[1]?.includes("`payload_hash` =");
        return { rows: hashFiltered ? prior.filter((row) => params.includes(row[2])) : prior };
      }
      return { rows: [{ insertId: 90, affectedRows: 1 }] };
    });
    // MySQL is an external boundary here. Keep its real generated queries;
    // production transaction/row-lock behavior also needs the staging check.
    Object.assign(db, { transaction: async (work: (tx: typeof db) => unknown) => work(db) });
    const mod = loadRoute<{ claimPublication(input: {
      eventId: number; destinationId: number; payloadHash: string; payload: Record<string, unknown>;
    }): Promise<{ kind: string; submissionId?: number; payloadChanged?: boolean; remoteId?: string | null }> }>(
      new URL("../src/lib/publishClaim.ts", import.meta.url),
      { "server-only": {}, "@/db": { db }, "@/db/schema": schema },
    );
    const result = await mod.claimPublication({
      eventId: 41, destinationId: 7, payloadHash: "edited-payload", payload: { title: "Edited title" },
    });
    return { result, queries };
  }

  for (const state of ["sending", "accepted_unreconciled"]) {
    it(`blocks an edited event while an older payload is ${state}`, async () => {
      const { result, queries } = await claim([[12, state, "old-payload", null]]);
      assert.equal(result.kind, "unresolved");
      assert.ok(!queries.some(({ sql }) => /^(insert|update) /i.test(sql)));
    });
  }

  it("does not create another post after a successfully published event is edited", async () => {
    const { result, queries } = await claim([[12, "succeeded", "old-payload", "5191"]]);
    assert.equal(result.kind, "already_sent");
    assert.equal(result.payloadChanged, true);
    assert.equal(result.remoteId, "5191");
    assert.ok(!queries.some(({ sql }) => /^(insert|update) /i.test(sql)));
  });

  it("serializes claims on the event before inspecting all destination attempts", async () => {
    const { queries } = await claim([[12, "sending", "old-payload", null]]);
    assert.match(queries[0].sql, /from `events`.*for update/);
    assert.ok(queries[0].params.includes(41));
    const history = queries.find(({ sql }) => sql.includes("from `publish_submissions`"))!;
    assert.match(history.sql, /`event_id` = \?/);
    assert.match(history.sql, /`destination_id` = \?/);
    assert.doesNotMatch(history.sql.split(" where ")[1], /`payload_hash` =/);
  });

  it("allows retrying a definitely rejected attempt", async () => {
    const { result, queries } = await claim([[12, "failed", "edited-payload", null]]);
    assert.equal(result.kind, "claimed");
    assert.equal(result.submissionId, 12);
    assert.ok(queries.some(({ sql, params }) => sql.startsWith("update ") && params.includes("sending")));
  });
});
