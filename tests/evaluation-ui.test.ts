import assert from "node:assert/strict";
import { it } from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadRoute } from "./helpers/load-route";
import * as ui from "../src/components/ui";
import * as evaluation from "../src/lib/evaluation";
import { drizzle } from "drizzle-orm/mysql-proxy";
import * as schema from "../src/db/schema";

it("renders explicit human confirmation controls, bounded import and independent scope guidance", () => {
  const { EvaluationWorkspace } = loadRoute<{ EvaluationWorkspace: (props: { sources: { id: number; name: string }[]; evaluations: never[] }) => ReactElement }>(new URL("../src/app/(app)/evaluations/EvaluationWorkspace.tsx", import.meta.url), {
    "next/navigation": { useRouter: () => ({ refresh() {} }) }, "@/components/ui": ui, "@/lib/evaluation": evaluation,
  });
  const html = renderToStaticMarkup(createElement(EvaluationWorkspace, { sources: [{ id: 7, name: "Synthetic source" }], evaluations: [] }));
  assert.match(html, /independently collected reference/);
  assert.match(html, /checked every match myself/);
  assert.match(html, /500 occurrences/);
  assert.match(html, /type="file"/);
  assert.match(html, /Snapshot JSON/);
  assert.match(html, /disabled=""[^>]*><span>Retain comparison/);
  assert.match(html, /<select class="input"/);
  assert.match(html, /<textarea class="input"/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /min-width:0/);
});

it("learning page exposes scoped failed generation and avoids claiming training effectiveness", async () => {
  const db = drizzle(async (sql) => {
    if (sql.includes("from `runs`")) return { rows: [[88, "2026-09-05 00:00:00", [{ eventId: 41, fieldName: "title", retryable: true }]]] };
    return { rows: [] };
  });
  const { default: Page } = loadRoute<{ default: () => Promise<ReactElement> }>(new URL("../src/app/(app)/learning/page.tsx", import.meta.url), {
    "@/db": { db }, "@/db/schema": schema, "@/components/ui": ui,
    "@/lib/auth": { requireUser: async () => ({ role: "community_admin" }), isAdmin: () => true },
    "@/lib/data": { currentCommunityId: async () => 3 },
  });
  const html = renderToStaticMarkup(await Page());
  assert.match(html, /Lesson generation failed/);
  assert.match(html, /href="\/runs\/88"/);
  assert.match(html, /href="\/review\/41"/);
  assert.match(html, /not.*fine-tuning/i);
  assert.doesNotMatch(html, /Every correction a person makes becomes/);
});

it("metrics render operational counts without claiming arrival accuracy or automatic human approval", async () => {
  const { default: Page } = loadRoute<{ default: () => Promise<ReactElement> }>(new URL("../src/app/(app)/metrics/page.tsx", import.meta.url), {
    "@/lib/auth": { requireUser: async () => ({ role: "platform_admin" }) },
    "@/lib/metrics": { MINUTES_PER_MANUAL_EVENT: 6, pilotMetrics: async () => ({ sourcesConnected: 1, eventsGathered: 2, duplicatesCaught: 1, currentUnflaggedPct: 50, approvedAsIsPct: null, approvedTotal: 0, totalReviewerEdits: 0, estimatedHoursSaved: 0, runsCompleted: 0, totalSpendUsd: 0, costPerEventUsd: 0, correctedCount: 0, correctedAccepted: 0, filteredIncomplete: 0, bySource: [], byModel: [], activeModel: "test" }) },
    "@/lib/modelList": { modelLabel: (v: string) => v },
    "./ModelPicker": { ModelPicker: () => null },
  });
  const html = renderToStaticMarkup(await Page());
  assert.match(html, /Current unflagged records/);
  assert.match(html, /href="\/evaluations"/);
  assert.doesNotMatch(html, /Complete on arrival|Complete-on-arrival/);
  assert.match(html, /not.*accuracy/i);
  assert.doesNotMatch(html, /Auto-rejects corrected|rescued by finding the missing field/);
});
