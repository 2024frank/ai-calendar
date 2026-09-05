import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it, type TestContext } from "node:test";
import * as schema from "../src/db/schema";
import { HARD_ISSUES } from "../src/lib/contract";
import { loadRoute } from "./helpers/load-route";
import { localSql } from "./helpers/local-sql";

function fixture(t: TestContext, options: { authenticated?: boolean; scoped?: boolean; fail?: boolean; modelResult?: Record<string,unknown>; duringModel?: (store: ReturnType<typeof localSql>["store"]) => void | Promise<void> } = {}) {
  const sql = localSql({ events: schema.events, sources: schema.sources, communities: schema.communities, runs: schema.runs, publish_submissions: schema.publishSubmissions });
  t.after(() => sql.store.close());
  sql.store.exec("INSERT INTO communities (id,slug,name,timezone) VALUES (3,'sample','Sample','America/New_York'); INSERT INTO sources (id,community_id,slug,name,url) VALUES (2,3,'arts','Arts','https://example.test/art')");
  for (const id of [40,41]) sql.store.prepare("INSERT INTO events (id,community_id,source_id,status,event_type,title,description,sessions,sponsors,post_type_ids,location_type,display_type,image_data,contact_email,phone,rejection_reason) VALUES (?,3,2,'pending','ot','Community Art Workshop','An arts workshop for everyone.',?,'[\"Arts center\"]','[89]','ne','all','image','events@example.test','440-555-0100','Missing before publish: destination_inventory_unavailable')").run(id, JSON.stringify([{ startTime: 2000000000, endTime: 2000007200 }]));
  const bounds = { "server-only": {}, "@/db": { db: sql.db }, "@/db/schema": schema };
  const lease = loadRoute<typeof import("../src/lib/correctionLease")>(new URL("../src/lib/correctionLease.ts",import.meta.url),bounds);
  let modelCalls = 0;
  const correction = loadRoute<typeof import("../src/lib/correction")>(new URL("../src/lib/correction.ts", import.meta.url), {
    ...bounds, "./correctionLease":lease, "./ingest": { HARD_ISSUES }, "./models": { modelChain: async () => ["test"] },
    "./llm": { llmComplete: async () => {
      modelCalls++; await options.duringModel?.(sql.store);
      if (options.fail) throw new Error("Provider unavailable");
      return { text: JSON.stringify(options.modelResult ?? { found: true, description: "Neighbors learn printmaking from local artists." }) };
    } },
    "./runEvents": { emit: async () => undefined }, "./fetchPage": {}, "./mergePosters": {},
  });
  const file = new URL("../src/lib/correctionRequest.ts", import.meta.url);
  assert.ok(existsSync(file), "exact event correction request command must exist");
  const request = loadRoute<typeof import("../src/lib/correctionRequest")>(file, { ...bounds, "./correctionLease":lease, "./correction": correction, "./models": { modelChain: async () => ["test"] } });
  const route = loadRoute<{ POST(req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> }>(new URL("../src/app/api/events/[id]/request-correction/route.ts", import.meta.url), {
    "@/lib/auth": { getSession: async () => options.authenticated === false ? null : { uid: 2, email: "reviewer@example.test" } },
    "@/lib/data": { getEventScoped: async () => options.scoped === false ? null : { id: 41, communityId: 3 } },
    "@/lib/correctionRequest": request, "@/lib/activity": { logActivity: async () => undefined },
  });
  return { ...sql, correctNext:()=>correction.correctNextEvent(9,2,3), modelCalls: () => modelCalls, call: (body: unknown = { note: "Correct the description using the source page." }) => route.POST(new Request("https://app.example/api/events/41/request-correction", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "41" }) }) };
}

describe("requested correction is exact and review-only", () => {
  for (const [options, status] of [[{ authenticated: false },401],[{ scoped: false },404]] as const) {
    it(`rejects unauthorized correction with ${status}`, async t => {
      const f = fixture(t, options); assert.equal((await f.call()).status, status); assert.equal(f.modelCalls(),0); assert.equal(f.queries.length,0);
    });
  }
  it("records a request, corrects only its event, returns pending and preserves inventory hold", async t => {
    const f = fixture(t); assert.equal((await f.call()).status,200);
    const event = f.store.prepare("SELECT * FROM events WHERE id=41").get()!;
    assert.equal(event.status,"pending"); assert.equal(event.correction_state,"completed");
    assert.match(String(event.correction_request),/Correct the description/);
    assert.match(String(event.rejection_reason),/destination_inventory_unavailable/);
    assert.equal(event.description,"Neighbors learn printmaking from local artists.");
    assert.equal(f.store.prepare("SELECT description FROM events WHERE id=40").get()!.description,"An arts workshop for everyone.");
    assert.equal(f.store.prepare("SELECT count(*) n FROM publish_submissions").get()!.n,0);
  });
  it("persists a visible retryable failure without permanently rejecting the event", async t => {
    const f = fixture(t,{ fail:true }); assert.equal((await f.call()).status,502);
    const event = f.store.prepare("SELECT * FROM events WHERE id=41").get()!;
    assert.equal(event.status,"pending"); assert.equal(event.correction_state,"failed"); assert.ok(event.correction_error);
    await f.call(); assert.equal(f.modelCalls(),2);
  });
  it("does not call an empty supported patch a completed correction",async t=> {
    const f=fixture(t,{modelResult:{found:true}});
    assert.equal((await f.call()).status,502);
    assert.equal(f.store.prepare("SELECT correction_state FROM events WHERE id=41").get()!.correction_state,"failed");
  });
  it("never modifies a successfully sent event even if its local status was changed", async t => {
    const f=fixture(t); f.store.exec("INSERT INTO publish_submissions (event_id,destination_id,state) VALUES (41,7,'succeeded')");
    assert.equal((await f.call()).status,409); assert.equal(f.modelCalls(),0);
  });
  for (const status of ["submitted","published","approved","rejected"]) {
    it(`does not correct an event in ${status}`,async t => {
      const f=fixture(t); f.store.prepare("UPDATE events SET status=? WHERE id=41").run(status);
      assert.equal((await f.call()).status,409); assert.equal(f.modelCalls(),0);
    });
  }
  it("does not overwrite a reviewer edit arriving while the model runs",async t => {
    const f=fixture(t,{ duringModel: store => store.exec("UPDATE events SET description='Reviewer changed this while correction ran.' WHERE id=41") });
    assert.equal((await f.call()).status,502);
    assert.equal(f.store.prepare("SELECT description FROM events WHERE id=41").get()!.description,"Reviewer changed this while correction ran.");
  });
  it("validates a nonempty bounded note before starting correction",async t => {
    const f=fixture(t); assert.equal((await f.call({note:""})).status,400);
    assert.equal((await f.call({note:"x".repeat(9000)})).status,413); assert.equal(f.modelCalls(),0);
  });
});

describe("automatic and reviewer correction share one protected lease",()=> {
  it("does not select an active reviewer correction for an automatic pass",async t=> {
    const f=fixture(t);
    f.store.prepare("UPDATE events SET status='auto_rejected',correction_state='running',correction_lease_token='reviewer-token',correction_requested_at=?,correction_request='Reviewer request' WHERE id=41").run(new Date().toISOString());
    await f.correctNext(); assert.equal(f.modelCalls(),0);
    assert.equal(f.store.prepare("SELECT correction_request FROM events WHERE id=41").get()!.correction_request,"Reviewer request");
  });
  for (const [name,statement,field,value] of [
    ["rejection","UPDATE events SET status='rejected',rejection_reason='Not a community event' WHERE id=41","status","rejected"],
    ["edit","UPDATE events SET description='New reviewer description' WHERE id=41","description","New reviewer description"],
  ] as const) {
    it(`preserves a reviewer ${name} arriving during automatic correction`,async t=> {
      const f=fixture(t,{duringModel:store=>{store.exec(statement);}});
      f.store.exec("UPDATE events SET status='auto_rejected' WHERE id=41");
      const result=await f.correctNext(); assert.equal(result.failed,true);
      assert.equal(f.store.prepare(`SELECT ${field} value FROM events WHERE id=41`).get()!.value,value);
    });
  }
  it("refuses an overlapping reviewer request while the worker holds the event",async t=> {
    let attempted=false; let competingStatus:number|undefined;
    const f=fixture(t,{duringModel:async()=>{if(attempted)return;attempted=true;competingStatus=(await f.call()).status;}});
    f.store.exec("UPDATE events SET status='auto_rejected' WHERE id=41");
    const result=await f.correctNext(); assert.equal(result.fixed,true);
    assert.equal(competingStatus,409); assert.equal(f.modelCalls(),1);
  });
});
