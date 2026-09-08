import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { HARD_ISSUES } from "../src/lib/contract";
import { loadRoute } from "./helpers/load-route";
import { localSql } from "./helpers/local-sql";

describe("automatic correction publishing holds", () => {
  async function correct(t: TestContext, reason: string) {
    const event = {
      id: 41, sourceId: 2, communityId: 3, status: "auto_rejected", eventType: "ot",
      title: "Community Art Workshop", description: null, extendedDescription: null,
      sponsors: ["Example Arts Center"], imageCdnUrl: "https://example.com/image.jpg", imageData: null,
      website: "https://example.com/event", contactEmail: "events@example.com", phone: "440-555-0100",
      postTypeIds: [89], sessions: [{ startTime: 2_000_000_000, endTime: 2_000_007_200 }],
      locationType: "ph2", location: "Example Arts Center", urlLink: null, registrationUrl: null,
      rejectionReason: reason,
    };
    const f = localSql({events:schema.events,sources:schema.sources,communities:schema.communities,publish_submissions:schema.publishSubmissions,runs:schema.runs});
    t.after(()=>f.store.close());
    const db=f.db;
    await db.insert(schema.events).values({...event,status:"auto_rejected",eventType:"ot",locationType:"ph2"});
    f.store.exec("INSERT INTO sources(id,community_id,slug,name,url) VALUES (2,3,'arts-center','Arts Center','https://example.com/event'); INSERT INTO communities(id,slug,timezone) VALUES (3,'example','America/New_York')");
    const bounds={"server-only":{},"@/db":{db},"@/db/schema":schema};
    const lease=loadRoute<typeof import("../src/lib/correctionLease")>(new URL("../src/lib/correctionLease.ts",import.meta.url),bounds);
    const { correctNextEvent } = loadRoute<{
      correctNextEvent(runId: number, sourceId: number, communityId: number): Promise<{ fixed: boolean }>;
    }>(new URL("../src/lib/correction.ts", import.meta.url), {
      "server-only": {}, "@/db": { db }, "@/db/schema": schema,
      "./correctionLease":lease,
      "./ingest": { HARD_ISSUES },
      "./learningAgent": { lessonsFor: async () => "" },
      "./llm": { llmComplete: async () => ({ text: JSON.stringify({ found: true, description: "Neighbors can learn printmaking techniques from local artists." }) }) },
      "./models": { modelChain: async () => ["test-model"] },
      "./runEvents": { emit: async () => undefined },
      "./mergePosters": { mergePosterImages: async () => { throw new Error("Unexpected image download"); } },
      "./fetchPage": { fetchPage: async () => { throw new Error("Unexpected page download"); } },
    });
    const result = await correctNextEvent(9, 2, 3);
    assert.equal(result.fixed, true);
    return (await db.select().from(schema.events).where(eq(schema.events.id,41)))[0];
  }

  it("restores corrected events to review without dropping the inventory hold", async t => {
    const saved = await correct(t,"Auto-rejected (incomplete): description_missing, destination_inventory_unavailable");
    assert.equal(saved?.rejectionReason, "Missing before publish: destination_inventory_unavailable");
    assert.equal(saved?.description, "Neighbors can learn printmaking techniques from local artists.");
  });

  it("clears fixed field warnings for events without an operational hold", async t => {
    const saved = await correct(t,"Auto-rejected (incomplete): description_missing");
    assert.equal(saved?.rejectionReason, null);
  });
});
