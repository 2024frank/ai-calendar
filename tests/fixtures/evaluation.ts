/** Hand-labelled, synthetic evidence only. No production source records. */
export function fixture() {
  return {
    version: 1, sourceId: 7, title: "Hand-labelled pilot sample",
    period: { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" },
    scope: { description: "All public events on the source in September", referenceCompleteness: "complete", confirmed: true },
    provenance: {
      reference: { description: "Independent reviewer transcription from archived source", capturedAt: "2026-09-01T10:00:00Z", independent: true },
      extracted: { description: "Extraction run 12 snapshot", capturedAt: "2026-09-01T11:00:00Z" },
    },
    reference: [
      { id: "A", title: "Music", startTime: "2026-09-10T18:00:00Z", location: "Hall" },
      { id: "B", title: "Art", startTime: "2026-09-11T18:00:00Z" },
    ],
    extracted: [
      { id: "a", title: "Music", startTime: "2026-09-10T14:00:00-04:00", location: "Park" },
      { id: "c", title: "Dance", startTime: "2026-09-12T18:00:00Z" },
    ],
    matches: [{ referenceId: "A", extractedId: "a" }], humanConfirmedMatches: true,
  };
}
