import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEvaluationDraft, organizationPosts, sameOrganization, titleSimilarity } from "../src/lib/evaluationDraft";
import { validateEvaluation } from "../src/lib/evaluation";

const period = { start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") };
const context = {
  sourceId: 19, sourceName: "Oberlin Library", organizationNames: ["Oberlin Public Library"],
  period, capturedAt: new Date("2026-09-08T12:00:00Z"), inventoryAvailable: true,
};
const t = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const post = (id: number, title: string, start: string, extra: Record<string, unknown> = {}) => ({
  title, startTimes: [t(start)], sessions: [{ startTime: t(start), endTime: t(start) + 3600 }],
  location: "65 S Main Street", url: `https://hub.example/calendar/post/${id}`, sponsors: ["Oberlin Public Library"], ingestedPostUrl: null, ...extra,
});

describe("evaluation draft from CommunityHub and importer records", () => {
  it("keeps only the organization's own posts as the reference", () => {
    const kept = organizationPosts([
      post(1, "Storytime", "2026-09-11T15:00:00Z"),
      post(2, "Storytime", "2026-09-11T15:00:00Z", { ingestedPostUrl: "https://ai-calendar.example/review/9" }),
      post(3, "Farm Fridays", "2026-09-11T15:00:00Z", { sponsors: ["City Fresh"] }),
    ], ["Oberlin Public Library"]);
    assert.deepEqual(kept.map((p) => p.url), ["https://hub.example/calendar/post/1"]);
  });

  it("recognizes an organization whose name drifts between the two systems", () => {
    assert.equal(sameOrganization("Oberlin Library", "Oberlin Public Library"), true);
    assert.equal(sameOrganization("FAVA Gallery", "FAVA Gallery"), true);
    assert.equal(sameOrganization("Oberlin College", "Oberlin College's Department of Theater"), true);
    assert.equal(sameOrganization("Oberlin Library", "Oberlin Heritage Center"), false);
    assert.equal(sameOrganization("POWER", "Oberlin College"), false);
    const kept = organizationPosts([post(1, "Storytime", "2026-09-11T15:00:00Z")], ["Oberlin Library"]);
    assert.equal(kept.length, 1);
  });

  it("proposes one-to-one pairs by date and title, and lists misses in both directions", () => {
    const draft = buildEvaluationDraft(context, [
      post(10, "Storytime at Oberlin Public Library", "2026-09-11T15:00:00Z"),
      post(11, "L.E.G.O. Club", "2026-09-09T20:00:00Z"),
      post(12, "Book Sale", "2026-09-20T14:00:00Z"),
      post(13, "Outside the period", "2026-11-20T14:00:00Z"),
    ], [
      { id: 501, title: "Storytime at Oberlin Public Library", status: "pending", sessions: [{ startTime: t("2026-09-11T15:00:00Z"), endTime: t("2026-09-11T16:00:00Z") }], location: "65 S Main Street, Oberlin, OH 44074", calendarSourceUrl: "https://library.example/storytime", website: null },
      { id: 502, title: "L.E.G.O.", status: "approved", sessions: [{ startTime: t("2026-09-09T20:00:00Z"), endTime: t("2026-09-09T21:00:00Z") }], location: null, calendarSourceUrl: null, website: "https://library.example" },
      { id: 503, title: "Storytime at Oberlin Public Library", status: "duplicate", sessions: [{ startTime: t("2026-09-11T15:00:00Z"), endTime: t("2026-09-11T16:00:00Z") }], location: null, calendarSourceUrl: null, website: null },
      { id: 504, title: "Teen Craft Night", status: "pending", sessions: [{ startTime: t("2026-09-25T22:00:00Z"), endTime: t("2026-09-25T23:00:00Z") }], location: null, calendarSourceUrl: null, website: null },
    ]);
    assert.deepEqual(draft.reference.map((r) => r.id), ["hub-10", "hub-11", "hub-12"]);
    assert.deepEqual(draft.extracted.map((r) => r.id), ["ai-501-pending", "ai-502-approved", "ai-504-pending"]);
    assert.deepEqual(draft.matches, [
      { referenceId: "hub-10", extractedId: "ai-501-pending" },
      { referenceId: "hub-11", extractedId: "ai-502-approved" },
    ]);
    assert.equal(draft.humanConfirmedMatches, false);
    assert.equal(draft.scope.confirmed, false);
    assert.equal(draft.scope.referenceCompleteness, "partial");
    assert.ok(draft.notes.some((n) => /Check each one/.test(n)));
    // Once a person confirms, the draft is a valid retained comparison.
    const { notes: _notes, ...snapshot } = draft;
    void _notes;
    const confirmed = validateEvaluation({ ...snapshot, scope: { ...snapshot.scope, confirmed: true }, humanConfirmedMatches: true });
    assert.equal(confirmed.matches.length, 2);
  });

  it("says so when CommunityHub could not be read", () => {
    const draft = buildEvaluationDraft({ ...context, inventoryAvailable: false }, [], []);
    assert.equal(draft.reference.length, 0);
    assert.equal(draft.scope.referenceCompleteness, "unknown");
    assert.ok(draft.notes.some((n) => /could not be read/.test(n)));
  });

  it("scores titles loosely enough for punctuation and containment", () => {
    assert.equal(titleSimilarity("L.E.G.O.", "L.E.G.O. Club"), 1);
    assert.ok(titleSimilarity("Storytime", "Farm Fridays") < 0.5);
  });
});
