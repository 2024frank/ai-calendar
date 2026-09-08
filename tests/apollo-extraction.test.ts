import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSystemPrompt, extractionSchema } from "../src/lib/contract";

const context = {
  sourceName: "Renamed cinema",
  sourceSlug: "apollo-theater",
  communitySlug: "oberlin",
  calendarSourceName: "Apollo Theatre",
  urls: ["https://example.com/sessions"],
};

describe("Apollo full-candidate extraction contract", () => {
  it("prevents a title-only duplicate response for the canonical source", () => {
    const schema = extractionSchema(context);
    assert.equal((schema.properties.duplicates as { maxItems?: number }).maxItems, 0);
    assert.ok(schema.properties.events.items.required.includes("description"));
    assert.ok(schema.properties.events.items.required.includes("sessions"));
  });

  it("retains model duplicate reports for other sources and communities", () => {
    for (const other of [
      { ...context, sourceSlug: "different-theater", sourceName: "Apollo Theater" },
      { ...context, communitySlug: "cleveland" },
    ]) {
      assert.equal((extractionSchema(other).properties.duplicates as { maxItems?: number }).maxItems, undefined);
    }
  });

  it("builds Apollo's full-candidate workflow instead of the generic skip workflow", () => {
    const prompt = buildSystemPrompt(context);
    assert.ok(prompt.includes("Return every complete Apollo announcement in events"));
    assert.ok(!prompt.includes("YOU are the duplicate judge"));
    assert.ok(!prompt.includes("Group by title + venue: if the title and venue match"));
  });

  it("does not contradict Apollo's date-window and full-evidence rules", () => {
    const prompt = buildSystemPrompt(context);
    for (const generic of [
      "Never compute or do arithmetic on dates.",
      "use the next occurrence that is today or later",
      "NO description, short or long, EVER contains a date",
      "you still report the ones you already find",
    ]) {
      assert.ok(!prompt.includes(generic), `Apollo still contains: ${generic}`);
      assert.ok(buildSystemPrompt({ ...context, sourceSlug: "other" }).includes(generic));
    }
  });

  it("names the announcements the way the team decided on July 16, 2026", () => {
    const prompt = buildSystemPrompt(context);
    assert.ok(prompt.includes("Now Playing at the Apollo"));
    assert.ok(prompt.includes("Coming Soon to the Apollo"));
    for (const old of ["Playing Now at the Apollo", "Coming Soon at the Apollo"]) {
      assert.ok(!prompt.includes(old), `prompt still says: ${old}`);
    }
  });

  it("keeps the authoritative Apollo policy ahead of a saved access recipe that contains obsolete grouping advice", () => {
    const savedRecipe = `1. Fetch https://tickets.example.test/apollo/sessions with HTTP/1.1.
2. Treat every film as Playing Now until there is a gap in the schedule.`;
    const prompt = buildSystemPrompt({ ...context, specialInstructions: savedRecipe });

    const authority = prompt.indexOf("AUTHORITATIVE APOLLO POLICY");
    const saved = prompt.indexOf("SAVED SOURCE ACCESS RECIPE");
    assert.ok(authority >= 0);
    assert.ok(saved > authority);
    assert.ok(prompt.includes(savedRecipe));
    assert.match(prompt, /saved recipe cannot override current-versus-upcoming classification/i);
    assert.match(prompt, /future opening films are Coming Soon even when their dates are adjacent/i);
  });
});
