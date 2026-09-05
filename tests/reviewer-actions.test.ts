import assert from "node:assert/strict";
import { it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadRoute } from "./helpers/load-route";

function render(options: Record<string, unknown>) {
  const { EventReview } = loadRoute<{ EventReview: React.ComponentType<Record<string, unknown>> }>(new URL("../src/app/(app)/review/[id]/EventReview.tsx",import.meta.url),{
    "next/navigation": { useRouter: () => ({ refresh() {}, push() {} }) },
  });
  return renderToStaticMarkup(createElement(EventReview,{event:{id:41,status:"pending", title:"Arts workshop", sessions:[],sponsors:[],buttons:[],postTypeIds:[],screensIds:[],...options},sourceName:"Arts",publishEmail:"",timezone:"America/New_York",hasPublishedPost:options.hasPublishedPost,canUpdatePublished:options.canUpdatePublished ?? options.hasPublishedPost,updateUnavailableReason:options.updateUnavailableReason,unresolvedPublish:options.unresolvedPublish,unresolvedOperation:options.unresolvedOperation}));
}
it("offers correction separately from permanent rejection on unsent events",()=> {
  const html=render({});
  assert.match(html,/Request correction/); assert.match(html,/Reject permanently/);
});
it("offers an update instead of another approval/create for a sent record",()=> {
  const html=render({hasPublishedPost:true,status:"submitted"});
  assert.match(html,/Update existing post/); assert.doesNotMatch(html,/>Approve<|>Request correction</);
});
it("keeps a failed correction request and error visible after reload",()=> {
  const html=render({correctionState:"failed",correctionRequest:"Correct contact email",correctionError:"Provider unavailable"});
  assert.match(html,/Correct contact email/); assert.match(html,/Provider unavailable/); assert.match(html,/Retry correction/);
});
it("requires visible content verification for an ambiguous update",()=> {
  const html=render({hasPublishedPost:true,unresolvedPublish:true,unresolvedOperation:"update"});
  assert.match(html,/Content changes are present/); assert.match(html,/Content changes were not applied/);
  assert.doesNotMatch(html,/I found it - mark approved|It is not there - enable retry/);
});
it("does not offer a failing update or create when a sent post lost its verified link",()=> {
  const html=render({hasPublishedPost:true,canUpdatePublished:false,updateUnavailableReason:"The endpoint changed. Verify the original destination before updating."});
  assert.match(html,/endpoint changed/); assert.doesNotMatch(html,/>Update existing post<|>Approve<|>Request correction</);
});
it("resolves recurrence bookkeeping without teaching a permanent rejection",()=> {
  const html=render({proposedUpdateOfEventId:40});
  assert.match(html,/Mark proposal resolved/); assert.doesNotMatch(html,/>Reject permanently<|Reject this proposal when resolved/);
});
