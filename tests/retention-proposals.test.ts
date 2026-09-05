import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import * as schema from "../src/db/schema";
import { loadRoute } from "./helpers/load-route";
import { localSql } from "./helpers/local-sql";

const NOW = Date.parse("2026-09-05T12:00:00Z");
const OLD_START = Math.floor(Date.parse("2026-09-01T12:00:00Z") / 1_000);
const FUTURE_START = Math.floor(Date.parse("2026-09-10T12:00:00Z") / 1_000);

function fixture(t: TestContext) {
  const sql = localSql({
    communities: schema.communities,
    events: schema.events,
    runs: schema.runs,
    sources: schema.sources,
  });
  t.after(() => sql.store.close());
  sql.store.exec("INSERT INTO communities (id,slug,name,timezone) VALUES (1,'sample','Sample','UTC')");
  const retention = loadRoute<typeof import("../src/lib/retention")>(
    new URL("../src/lib/retention.ts", import.meta.url),
    {
      "server-only": {},
      "@/db": { db: sql.db },
      "@/db/schema": schema,
      "./schedule": { scheduledSourceIsDue: () => false },
    },
  );
  const insert = sql.store.prepare(`INSERT INTO events
    (id,community_id,status,title,start_time_max,proposed_update_of_event_id,proposal_resolved_at,created_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  const ids = () => (sql.store.prepare("SELECT id FROM events ORDER BY id").all() as { id: number }[])
    .map((row) => row.id);
  return { ...sql, retention, insert, ids };
}

describe("proposal-safe event retention", () => {
  it("keeps expired originals until every referencing proposal expires, including resolved proposals", async (t) => {
    const f = fixture(t);
    const oldCreated = "2026-01-01 00:00:00";
    f.insert.run(40, 1, "submitted", "Unresolved original", OLD_START, null, null, oldCreated);
    f.insert.run(41, 1, "pending", "Unresolved proposal", FUTURE_START, 40, null, oldCreated);
    f.insert.run(42, 1, "submitted", "Resolved original", OLD_START, null, null, oldCreated);
    f.insert.run(43, 1, "duplicate", "Resolved proposal", FUTURE_START, 42, "2026-09-04 12:00:00", oldCreated);
    f.insert.run(44, 1, "submitted", "Unreferenced expired event", OLD_START, null, null, oldCreated);

    assert.equal(await f.retention.sweepExpiredEvents(NOW), 1);
    assert.deepEqual(f.ids(), [40, 41, 42, 43]);

    f.store.prepare("UPDATE events SET start_time_max=? WHERE id IN (41,43)").run(OLD_START);
    assert.equal(await f.retention.sweepExpiredEvents(NOW), 2, "the expired proposal rows leave first");
    assert.deepEqual(f.ids(), [40, 42], "parents conservatively survive the proposal-removal sweep");

    assert.equal(await f.retention.sweepExpiredEvents(NOW), 2);
    assert.deepEqual(f.ids(), []);
  });

  it("also protects referenced originals in the dateless age sweep", async (t) => {
    const f = fixture(t);
    const oldCreated = "2026-01-01 00:00:00";
    f.insert.run(50, 1, "duplicate", "Referenced dateless original", null, null, null, oldCreated);
    f.insert.run(51, 1, "pending", "Future proposal", FUTURE_START, 50, null, oldCreated);
    f.insert.run(52, 1, "duplicate", "Unreferenced dateless event", null, null, null, oldCreated);

    assert.equal(await f.retention.sweepExpiredEvents(NOW), 1);
    assert.deepEqual(f.ids(), [50, 51]);
  });
});
