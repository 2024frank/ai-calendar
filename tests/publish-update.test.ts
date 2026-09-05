import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it, type TestContext } from "node:test";
import * as schema from "../src/db/schema";
import { loadRoute } from "./helpers/load-route";
import { localSql } from "./helpers/local-sql";

function fixture(t: TestContext, options: { response?: number | "timeout"; authenticated?: boolean; scoped?: boolean; responseBody?: string; readFailure?: boolean; createConfigured?: boolean; realDestination?: boolean } = {}) {
  const sql = localSql({ events: schema.events, publish_submissions: schema.publishSubmissions, communities:schema.communities,destinations:schema.destinations,sources:schema.sources });
  t.after(() => sql.store.close());
  sql.store.prepare("INSERT INTO events (id, community_id, status, title, description, event_type, location_type, sessions, sponsors, post_type_ids) VALUES (41,3,'submitted','New title','A complete community arts workshop.','ot','ne',?, ?, ?)")
    .run(JSON.stringify([{ startTime: 2000000000, endTime: 2000003600 }]), '["Arts center"]', '[89]');
  sql.store.prepare("UPDATE events SET display_type='all', image_data='test-image', contact_email='events@example.test', phone='440-555-0100' WHERE id=41").run();
  const network: { url: string; method: string; payload: Record<string, unknown> }[] = [];
  const bounds = { "server-only": {}, "@/db": { db: sql.db }, "@/db/schema": schema };
  const responseReader = async (response: Response, limit: number) => {
    if (options.readFailure) throw new Error("Response stream failed");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error("Response too large");
    return bytes;
  };
  const publicBoundary = { assertPublicHttpUrl: async () => undefined, fetchPinnedPublicUrl: async (url: string, init: RequestInit) => {
    network.push({ url, method: init.method!, payload: JSON.parse(String(init.body)) });
    if (options.response === "timeout") throw new Error("connection closed");
    return { response: new Response(options.responseBody ?? '{"id":5191}', { status: options.response ?? 200 }), close: async () => undefined };
  } };
  const destination = { id: 7, config: { submit_url: "https://hub.example/api/legacy/calendar/post/submit" } };
  sql.store.exec("INSERT INTO communities(id,status,default_destination_id) VALUES (3,'active',7)");
  sql.store.prepare("INSERT INTO destinations(id,community_id,active,config) VALUES (7,3,1,?)").run(JSON.stringify(destination.config));
  const destinationResolver=loadRoute<typeof import("../src/lib/destination")>(new URL("../src/lib/destination.ts",import.meta.url),bounds);
  const claim = loadRoute<typeof import("../src/lib/publishClaim")>(new URL("../src/lib/publishClaim.ts", import.meta.url), bounds);
  const publication = loadRoute<typeof import("../src/lib/publishEvent")>(new URL("../src/lib/publishEvent.ts", import.meta.url), {
    ...bounds, "./fetchPage": {readResponseBytesLimited:responseReader}, "./publicUrl": publicBoundary, "./destination": options.realDestination ? destinationResolver : {resolveDestination:async()=>({destination:options.createConfigured ? destination : null,error:null})}, "./inlineImage": {}, "./publishClaim": claim,
    "./imagePublishToken": { imagePublishToken: () => "test-token" },
  });
  const file = new URL("../src/lib/publishUpdate.ts", import.meta.url);
  assert.ok(existsSync(file), "explicit publishUpdate command must exist");
  const updater = loadRoute<typeof import("../src/lib/publishUpdate")>(file, {
    ...bounds, "./publishEvent": publication, "./publishClaim": claim,
    "./inlineImage": {inlineRemoteImage:async()=>({imageData:"new-image-bytes"}),INLINE_IMAGE_FAILURE_TEXT:{}},
    "./destination": options.realDestination ? destinationResolver : { resolveDestination: async () => ({ destination, error: null }) },
    "./fetchPage": { readResponseBytesLimited: responseReader },
    "./publicUrl": publicBoundary,
  });
  const routeFile = new URL("../src/app/api/events/[id]/update-published/route.ts", import.meta.url);
  assert.ok(existsSync(routeFile), "authenticated update handler must exist");
  const route = loadRoute<{ POST(req: Request, context: { params: Promise<{ id: string }> }): Promise<Response> }>(routeFile, {
    "@/lib/auth": { getSession: async () => options.authenticated === false ? null : { uid: 2, email: "reviewer@example.test" } },
    "@/lib/data": { getEventScoped: async () => options.scoped === false ? null : { id: 41, status: "submitted", title: "New title" } },
    "@/lib/publishUpdate": updater, "@/lib/activity": { logActivity: async () => undefined },
  });
  const endpoint=loadRoute<{PUT(req:Request,ctx:{params:Promise<{id:string}>}):Promise<Response>}>(new URL("../src/app/api/communities/[id]/endpoint/route.ts",import.meta.url),{...bounds,"@/lib/auth":{getSession:async()=>({uid:2,role:"platform_admin"})},"@/lib/data":{accessibleCommunities:async()=>[]},"@/lib/publicUrl":{assertPublicHttpUrl:async()=>undefined,isPublicHttpUrl:()=>true}});
  const seed = (remoteId: string | null = "5191", payload = { title: "Old title" }, endpointUrl:string|null=destination.config.submit_url) => sql.store.prepare("INSERT INTO publish_submissions (id,event_id,destination_id,state,external_post_id,payload,operation,payload_hash,destination_submit_url) VALUES (12,41,7,'succeeded',?,?,'create','initial',?)").run(remoteId, JSON.stringify(payload),endpointUrl);
  return { ...sql, network, seed, changeEndpoint:()=>endpoint.PUT(new Request("https://app.example/api/communities/3/endpoint",{method:"PUT",body:JSON.stringify({apiBase:"https://other.example",active:true})}),{params:Promise.resolve({id:"3"})}), callCreate:()=>publication.publishEvent(41,"approved"), call: () => route.POST(new Request("https://app.example/api/events/41/update-published", { method: "POST" }), { params: Promise.resolve({ id: "41" }) }) };
}

describe("reviewer-controlled destination updates", () => {
  for (const options of [{responseBody:"{}"},{readFailure:true},{responseBody:'{"id":5191,"success":false}'}]) {
    it(`does not confirm a create with an untrustworthy acknowledgment ${JSON.stringify(options)}`,async t=> {
      const f=fixture(t,{...options,createConfigured:true});
      f.store.exec("UPDATE events SET status='pending' WHERE id=41");
      assert.equal((await f.callCreate()).state,"unknown");
      assert.equal(f.store.prepare("SELECT state FROM publish_submissions").get()!.state,"accepted_unreconciled");
      assert.equal(f.store.prepare("SELECT status FROM events").get()!.status,"pending");
      await f.callCreate(); assert.equal(f.network.length,1);
    });
  }
  for (const [options, status] of [[{ authenticated: false },401], [{ scoped: false },404]] as const) {
    it(`rejects unauthorized access with ${status}`, async t => {
      const f = fixture(t, options); const response = await f.call();
      assert.equal(response.status, status); assert.equal(f.network.length, 0); assert.equal(f.queries.length, 0);
    });
  }
  it("refuses missing remote links without a create", async t => {
    const f = fixture(t); f.seed(null); const response = await f.call();
    assert.equal(response.status, 409); assert.equal(f.network.length, 0);
  });
  it("cannot create a new post from a recurrence update proposal",async t=> {
    const f=fixture(t); f.store.exec("UPDATE events SET proposed_update_of_event_id=40 WHERE id=41");
    const result=await f.callCreate(); assert.equal(result.state,"skipped"); assert.equal(result.ok,false); assert.equal(f.network.length,0);
  });
  it("refuses updates after the event's configured destination changed",async t=> {
    const f=fixture(t); f.seed(); f.store.exec("UPDATE publish_submissions SET destination_id=8");
    assert.equal((await f.call()).status,409); assert.equal(f.network.length,0);
  });
  it("does not PATCH an old numeric id to a new host after the endpoint route edits the same destination id",async t=> {
    const f=fixture(t,{realDestination:true}); f.seed();
    const changed=await f.changeEndpoint(); assert.equal(changed.status,200); assert.equal((await changed.json()).destinationId,7);
    assert.equal((await f.call()).status,409); assert.equal(f.network.length,0);
  });
  it("holds historical remote links whose endpoint provenance is unknown",async t=> {
    const f=fixture(t); f.seed("5191",{title:"Old title"},null);
    assert.equal((await f.call()).status,409); assert.equal(f.network.length,0);
  });
  it("records the actual new endpoint when retrying a definitely rejected create after a configuration change",async t=> {
    const f=fixture(t,{realDestination:true,response:422});
    await f.callCreate(); await f.changeEndpoint(); await f.callCreate();
    assert.equal(f.network.length,2);
    assert.equal(f.store.prepare("SELECT destination_submit_url FROM publish_submissions").get()!.destination_submit_url,"https://other.example/api/legacy/calendar/post/submit");
  });
  it("PATCHes only content to the linked destination id and preserves local moderation status", async t => {
    const f = fixture(t); f.seed(); const response = await f.call();
    assert.equal(response.status, 200); assert.equal(f.network.length, 1);
    assert.equal(f.network[0].url, "https://hub.example/api/legacy/calendar/post/5191/submit");
    assert.equal(f.network[0].method, "PATCH"); assert.equal(f.network[0].payload.title, "New title");
    for (const key of ["public", "subscribe", "email"]) assert.ok(!(key in f.network[0].payload));
    assert.equal(f.store.prepare("SELECT status FROM events WHERE id=41").get()!.status, "submitted");
    assert.equal(f.store.prepare("SELECT state FROM publish_submissions WHERE id=13").get()!.state, "succeeded");
    const again = await f.call(); assert.equal(again.status, 200); assert.equal(f.network.length, 1);
  });
  it("rehosts a reviewer-selected replacement image before updating the remote image",async t=> {
    const f=fixture(t); f.seed(); f.store.exec("UPDATE events SET image_cdn_url='https://images.example.test/new.jpg',image_data='old-image-bytes' WHERE id=41");
    assert.equal((await f.call()).status,200);
    assert.equal(f.store.prepare("SELECT image_data FROM events WHERE id=41").get()!.image_data,"new-image-bytes");
    assert.match(String(f.network[0].payload.image_cdn_url),/\/api\/events\/41\/image.jpg\?publish_token=/);
    assert.doesNotMatch(JSON.stringify(f.network[0].payload),/images.example.test/);
  });
  for (const [name, options] of [
    ["empty JSON", {responseBody:"{}"}], ["HTML", {responseBody:"<html>Sign in</html>"}],
    ["wrong post", {responseBody:'{"id":999}'}], ["failure acknowledgment", {responseBody:'{"id":5191,"success":false}'}],
    ["oversized body", {responseBody:" ".repeat(256*1024+1)+'{"id":5191}'}], ["unreadable body", {readFailure:true}],
  ] as const) {
    it(`holds a 2xx response with ${name} for reconciliation`,async t=> {
      const f=fixture(t,options); f.seed(); const response=await f.call();
      assert.equal(response.status,409);
      assert.equal(f.store.prepare("SELECT state FROM publish_submissions WHERE id=13").get()!.state,"accepted_unreconciled");
      await f.call(); assert.equal(f.network.length,1);
    });
  }
  for (const [response, status, state] of [[422,502,"failed"],[500,409,"accepted_unreconciled"],["timeout",409,"sending"]] as const) {
    it(`retains ${state} for downstream ${response}`, async t => {
      const f = fixture(t, { response }); f.seed(); const result = await f.call();
      assert.equal(result.status, status);
      assert.equal(f.store.prepare("SELECT state FROM publish_submissions WHERE id=13").get()!.state, state);
      await f.call(); assert.equal(f.network.length, state === "failed" ? 2 : 1);
      assert.equal(f.store.prepare("SELECT count(*) n FROM publish_submissions").get()!.n,2,"retry must reuse the failed update claim");
    });
  }
});
