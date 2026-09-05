import { useState } from "react";
import { EventReview } from "../../src/app/(app)/review/[id]/EventReview";
import { EvaluationWorkspace } from "../../src/app/(app)/evaluations/EvaluationWorkspace";
import { Card } from "../../src/components/ui";

const fixtureEvent = {
  id: 900, status: "pending", eventType: "ot", title: "Synthetic neighborhood concert",
  description: "A fictional community concert used only to check the review interface.", extendedDescription: null,
  sessions: [{ startTime: Date.parse("2026-09-20T18:00:00-04:00") / 1000, endTime: Date.parse("2026-09-20T20:00:00-04:00") / 1000 }],
  locationType: "ne", location: "100 Example Street", placeName: "Example Hall", roomNum: null,
  geoScope: "city_wide", urlLink: null, displayType: "all", screensIds: [], postTypeIds: [1],
  sponsors: ["Synthetic community organization"], buttons: [], website: "https://example.org/concert",
  registrationUrl: null, imageCdnUrl: null, hasImageData: true, contactEmail: "fixture@example.org",
  phone: "555-0100", calendarSourceName: "Synthetic source", calendarSourceUrl: "https://example.org/concert",
  ingestedPostUrl: null, fieldNotes: null, rejectionReason: null, duplicateOfEventId: null,
  duplicateOfUrl: null, duplicateOfTitle: null,
};

export function PilotWorkflowPreview({ kind }: { kind: "review" | "evaluations" }) {
  const [scenario, setScenario] = useState("pending");
  if (kind === "evaluations") return <EvaluationWorkspace sources={[{ id: 1, name: "Synthetic arts source" }]} evaluations={[{ id: 901, title: "Synthetic comparison: two snapshots", createdAt: "2026-09-05T15:00:00Z" }]} />;
  const sent = ["sent", "sent-unlinked", "uncertain-update"].includes(scenario);
  const event = {
    ...fixtureEvent,
    status: sent ? "approved" : "pending",
    correctionState: scenario.startsWith("correction-") ? scenario.slice("correction-".length) : null,
    correctionError: scenario === "correction-failed" ? "Synthetic provider failure. Your saved event was not changed." : null,
    correctionRequest: scenario === "correction-failed" ? "Check the long description against the source page." : null,
    proposedUpdateOfEventId: scenario.startsWith("recurrence") ? 899 : null,
    proposalResolvedAt: scenario === "recurrence-resolved" ? "2026-09-05T15:00:00Z" : null,
  };
  return <>
    <Card><label className="label" htmlFor="review-scenario">Review test scenario</label>
      <select className="input" id="review-scenario" value={scenario} onChange={e => setScenario(e.target.value)}>
        <option value="pending">Unsent event</option><option value="sent">Existing CommunityHub post</option>
        <option value="sent-unlinked">Sent post with unverified endpoint</option>
        <option value="correction-failed">Failed correction, retry available</option>
        <option value="correction-running">Correction running</option><option value="correction-completed">Correction returned to review</option>
        <option value="uncertain-update">Uncertain content update</option><option value="recurrence">New-date proposal for an existing post</option>
        <option value="recurrence-resolved">Resolved new-date proposal</option>
      </select>
      <p className="muted">Synthetic endpoints only. Correction requests return a deliberate error; updates simulate success without contacting CommunityHub.</p>
    </Card>
    <EventReview key={scenario} event={event} sourceName="Synthetic arts source" publishEmail="fixture@example.org" timezone="America/New_York" hasPublishedPost={sent} canUpdatePublished={sent && scenario !== "sent-unlinked"} updateUnavailableReason={scenario === "sent-unlinked" ? "This synthetic historical post has no recorded endpoint provenance. Verify its original destination before updating; no new post will be created." : null} unresolvedPublish={scenario === "uncertain-update"} unresolvedOperation="update" />
  </>;
}
