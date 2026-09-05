import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "../src/db/schema";
import { loadRoute } from "./helpers/load-route";
import { localSql } from "./helpers/local-sql";

async function claim(history: unknown[][], operation: "create" | "update" = "update", payload: Record<string, unknown> = { title: "Edited" }) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const db = drizzle(async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes("from `events`")) return { rows: [[41, null]] };
    if (sql.includes("from `publish_submissions`")) return { rows: history.map(row=>[...row,7,"https://hub.example/api/legacy/calendar/post/submit"]) };
    return { rows: [{ insertId: 90, affectedRows: 1 }] };
  });
  Object.assign(db, { transaction: async (fn: (tx: typeof db) => unknown) => fn(db) });
  const mod = loadRoute<{ claimPublication(input: Record<string, unknown>): Promise<Record<string, unknown>> }>(
    new URL("../src/lib/publishClaim.ts", import.meta.url), { "server-only": {}, "@/db": { db }, "@/db/schema": schema },
  );
  return { result: await mod.claimPublication({ eventId: 41, destinationId: 7, payloadHash: "edited", payload, operation, destinationSubmitUrl:"https://hub.example/api/legacy/calendar/post/submit" }), queries };
}

describe("explicit update claim", () => {
  it("never turns an update without a linked successful create into a create", async () => {
    const { result, queries } = await claim([]);
    assert.equal(result.kind, "not_linked");
    assert.ok(!queries.some(q => q.sql.startsWith("insert ")));
  });
  it("requires a stored numeric remote id", async () => {
    const { result } = await claim([[12, "succeeded", "old", null, { title: "Before" }, "create"]]);
    assert.equal(result.kind, "not_linked");
  });
  it("claims a content-only patch against the existing remote post", async () => {
    const { result, queries } = await claim([[12, "succeeded", "old", "5191", { title: "Before", public: "0", subscribe: false, email: "old@example.test" }, "create"]]);
    assert.equal(result.kind, "claimed");
    assert.equal(result.remoteId, "5191");
    assert.deepEqual(result.patch, { title: "Edited" });
    assert.match(queries[0].sql, /for update/);
    assert.ok(queries.some(q => q.sql.startsWith("insert ") && q.params.includes("update")));
  });
  it("does not PATCH unchanged content", async () => {
    const { result, queries } = await claim([[12, "succeeded", "old", "5191", { title: "Edited", public: "1" }, "create"]]);
    assert.equal(result.kind, "unchanged");
    assert.ok(!queries.some(q => q.sql.startsWith("insert ")));
  });
  it("ignores MySQL JSON object key ordering without ignoring array order", async () => {
    const previous = { buttons: [{ link: "https://example.org/register", title: "Register" }, { link: "https://example.org/info", title: "Details" }] };
    const payload = { buttons: [{ title: "Register", link: "https://example.org/register" }, { title: "Details", link: "https://example.org/info" }] };
    const history = [[12, "succeeded", "old", "5191", previous, "create"]];
    const { result, queries } = await claim(history, "update", payload);
    assert.equal(result.kind, "unchanged");
    assert.ok(!queries.some(q => q.sql.startsWith("insert ")));
    const reordered = await claim(history, "update", { buttons: [...payload.buttons].reverse() });
    assert.equal(reordered.result.kind, "claimed");
    assert.deepEqual(reordered.result.patch, { buttons: [...payload.buttons].reverse() });
  });
  it("treats omitted optional fields on an original create as empty",async()=> {
    const queries: unknown[]=[];
    const db=drizzle(async(sql,params)=>{
      queries.push(params);
      return {rows:sql.includes("from `events`")?[[41,null]]:sql.includes("from `publish_submissions`")?[[12,"succeeded","old","5191",{title:"Edited"},"create",7,"https://hub.example/api/legacy/calendar/post/submit"]]:[{insertId:90,affectedRows:1}]};
    });
    Object.assign(db,{transaction:async(fn:(tx:typeof db)=>unknown)=>fn(db)});
    const mod=loadRoute<typeof import("../src/lib/publishClaim")>(new URL("../src/lib/publishClaim.ts",import.meta.url),{"server-only":{},"@/db":{db},"@/db/schema":schema});
    const result=await mod.claimPublication({eventId:41,destinationId:7,payloadHash:"",operation:"update",destinationSubmitUrl:"https://hub.example/api/legacy/calendar/post/submit",payload:{title:"Edited",buttons:[],extendedDescription:""}});
    assert.equal(result.kind,"unchanged");
  });
  for (const operation of ["create", "update"] as const) {
    it(`blocks ${operation} while an update is ambiguous`, async () => {
      const { result } = await claim([[13, "accepted_unreconciled", "older", "5191", { title: "Before" }, "update"]], operation);
      assert.equal(result.kind, "unresolved");
    });
  }
  it("keeps the event-wide hold when destination settings change during a send",async t=> {
    const f=localSql({events:schema.events,publish_submissions:schema.publishSubmissions}); t.after(()=>f.store.close());
    f.store.exec("INSERT INTO events(id) VALUES (41); INSERT INTO publish_submissions(event_id,destination_id,state) VALUES (41,7,'sending')");
    const mod=loadRoute<typeof import("../src/lib/publishClaim")>(new URL("../src/lib/publishClaim.ts",import.meta.url),{"server-only":{},"@/db":{db:f.db},"@/db/schema":schema});
    const result=await mod.claimPublication({eventId:41,destinationId:8,payloadHash:"new",payload:{title:"New"}});
    assert.equal(result.kind,"unresolved");
    assert.equal(f.store.prepare("SELECT count(*) n FROM publish_submissions").get()!.n,1);
  });
  it("serializes concurrent create and update commands into one active submission",async t=> {
    const f=localSql({events:schema.events,publish_submissions:schema.publishSubmissions}); t.after(()=>f.store.close());
    f.store.exec("INSERT INTO events(id) VALUES (41)");
    const mod=loadRoute<typeof import("../src/lib/publishClaim")>(new URL("../src/lib/publishClaim.ts",import.meta.url),{"server-only":{},"@/db":{db:f.db},"@/db/schema":schema});
    const input={eventId:41,destinationId:7,payloadHash:"new",payload:{title:"New"}};
    const results=await Promise.all([mod.claimPublication(input),mod.claimPublication({...input,operation:"update"})]);
    assert.deepEqual(results.map(result=>result.kind),["claimed","unresolved"]);
    assert.equal(f.store.prepare("SELECT count(*) n FROM publish_submissions").get()!.n,1);
  });
});
