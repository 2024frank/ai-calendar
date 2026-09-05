import assert from "node:assert/strict";
import { it } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { localSql } from "./helpers/local-sql";
import { loadRoute } from "./helpers/load-route";

for (const status of ["approved","submitted","published","pending"]) {
  it(`keeps new dates as an unsent review proposal when the existing ${status} row was sent`,async t => {
    const f=localSql({events:schema.events,communities:schema.communities,sources:schema.sources,runs:schema.runs,publish_submissions:schema.publishSubmissions});
    t.after(()=>f.store.close());
    f.store.exec("INSERT INTO communities (id,slug,name,timezone,status,default_mode) VALUES (1,'sample','Sample','America/New_York','active','needs_approval'); INSERT INTO sources (id,community_id,slug,name,url,mode,lookahead_days,calendar_source_url) VALUES (1,1,'arts','Arts','https://example.test/events','needs_approval',14,'https://example.test/events'); INSERT INTO runs (id,community_id,source_id) VALUES (1,1,1)");
    const start=Math.floor(Date.now()/1000)+86400;
    const oldSessions=[{startTime:start,endTime:start+3600}];
    const newSessions=[...oldSessions,{startTime:start+7*86400,endTime:start+7*86400+3600}];
    const candidate={eventType:"ot",title:"Weekly printmaking",description:"Learn to make prints at our weekly arts workshop.",sessions:newSessions,locationType:"ph2",location:"Arts Center",postTypeId:[89],sponsors:["Arts Center"],website:"https://example.test/events/printmaking",calendarSourceUrl:"https://example.test/events/printmaking",imageData:"test-image",contactEmail:"events@example.test",phone:"440-555-0100"};
    await f.db.insert(schema.events).values({id:41,communityId:1,sourceId:1,status:status as "approved",eventType:"ot",title:candidate.title,description:candidate.description,sessions:oldSessions,locationType:"ph2",location:"Arts Center",displayType:"all",postTypeIds:[89],sponsors:candidate.sponsors,website:candidate.website,calendarSourceUrl:candidate.calendarSourceUrl,imageData:"test-image",contactEmail:candidate.contactEmail,phone:candidate.phone});
    f.store.exec("INSERT INTO publish_submissions (event_id,destination_id,state,external_post_id) VALUES (41,7,'succeeded','5191')");
    const ingest=loadRoute<typeof import("../src/lib/ingest")>(new URL("../src/lib/ingest.ts",import.meta.url),{
      "server-only":{},"@/db":{db:f.db},"@/db/schema":schema,
      "./fetchPage":{fetchPage:async()=>({ok:true,status:200,bytes:0,text:"",jsonLd:[]}),fetchPublicBytes:async()=>({ok:true,status:200,bytes:new Uint8Array()}),hasImageExtension:()=>true,isGenericImage:()=>false},
      "./inventory":{fetchDestinationInventory:async()=>({available:true,items:[]})},"./mergePosters":{},"./inlineImage":{inlineRemoteImage:async()=>({failure:"not used"})},"./email":{sendNewEventsDigest:async()=>undefined},"./runEvents":{emit:async()=>undefined},
      "./publishEvent":{publishEvent:async()=>{throw new Error("No automatic publication permitted");}},
    });
    const [source]=await f.db.select().from(schema.sources).where(eq(schema.sources.id,1));
    const [community]=await f.db.select().from(schema.communities).where(eq(schema.communities.id,1));
    await ingest.ingestEvents(1,source,community,[candidate],{deadlineAt:0});
    const rows=await f.db.select().from(schema.events);
    assert.equal(rows.length,2); assert.deepEqual(rows[0].sessions,oldSessions,"the sent event must not silently gain sessions");
    assert.equal(rows[1].status,"pending"); assert.equal(rows[1].proposedUpdateOfEventId,41); assert.deepEqual(rows[1].sessions,newSessions);
  });
}
