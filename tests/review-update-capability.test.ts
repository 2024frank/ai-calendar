import assert from "node:assert/strict";
import { it } from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { localSql } from "./helpers/local-sql";
import { loadRoute } from "./helpers/load-route";

for (const [name,id,recorded,current,canUpdate] of [
  ["verified link","5191","https://hub.example/api/legacy/calendar/post/submit","https://hub.example/api/legacy/calendar/post/submit",true],
  ["missing numeric id",null,"https://hub.example/api/legacy/calendar/post/submit","https://hub.example/api/legacy/calendar/post/submit",false],
  ["unknown historical endpoint","5191",null,"https://hub.example/api/legacy/calendar/post/submit",false],
  ["changed endpoint in same destination row","5191","https://hub.example/api/legacy/calendar/post/submit","https://other.example/api/legacy/calendar/post/submit",false],
] as const) {
  it(`renders actual scoped review page with ${name}`,async t=> {
    const f=localSql({events:schema.events,publish_submissions:schema.publishSubmissions,sources:schema.sources,communities:schema.communities,destinations:schema.destinations}); t.after(()=>f.store.close());
    f.store.exec("INSERT INTO events(id,community_id,status,title) VALUES (41,3,'submitted','Arts workshop'); INSERT INTO communities(id,status,default_destination_id) VALUES (3,'active',7)");
    f.store.prepare("INSERT INTO destinations(id,community_id,active,config) VALUES(7,3,1,?)").run(JSON.stringify({submit_url:current}));
    f.store.prepare("INSERT INTO publish_submissions(event_id,destination_id,state,external_post_id,destination_submit_url) VALUES(41,7,'succeeded',?,?)").run(id,recorded);
    const bounds={"server-only":{},"@/db":{db:f.db},"@/db/schema":schema};
    const destination=loadRoute<typeof import("../src/lib/destination")>(new URL("../src/lib/destination.ts",import.meta.url),bounds);
    const component=loadRoute<{EventReview:ComponentType<Record<string,unknown>>}>(new URL("../src/app/(app)/review/[id]/EventReview.tsx",import.meta.url),{"next/navigation":{useRouter:()=>({refresh(){},push(){}})}});
    const page=loadRoute<{default(props:unknown):Promise<React.ReactElement>}>(new URL("../src/app/(app)/review/[id]/page.tsx",import.meta.url),{
      ...bounds,"@/lib/destination":destination,"./EventReview":component,
      "@/lib/auth":{requireUser:async()=>({uid:2})},"@/lib/data":{getEventScoped:async()=> (await f.db.select().from(schema.events).where(eq(schema.events.id,41)))[0]},
      "next/link":{__esModule:true,default:({children,...props}:Record<string,unknown>)=>createElement("a",props,children as React.ReactNode)},
    });
    const html=renderToStaticMarkup(await page.default({params:Promise.resolve({id:"41"}),searchParams:Promise.resolve({})}));
    assert.equal(html.includes(">Update existing post<"),canUpdate);
    assert.doesNotMatch(html,/>Approve<|>Request correction</);
    if(!canUpdate) assert.match(html,/Update unavailable/);
  });
}
