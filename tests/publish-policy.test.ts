import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  HARD_ISSUES,
  maxEndTime,
  sessionsWithinLookahead,
  type ExtractedEvent,
} from "../src/lib/contract";
import {
  buttonsWithRegistration,
  publishedImageUrl,
  storedEventIssues,
  submissionBlocksRetry,
} from "../src/lib/publishPolicy";
import { validationOptionsForSource } from "../src/lib/sourcePolicy";

describe("stored event publish validation", () => {
  const dateBearingAnnouncement = {
    eventType: "an",
    title: "Coming Soon at the Apollo",
    description: "The Fantastic Four: opens August 7.",
    extendedDescription: "See the newest releases on the Apollo screen.",
    sessions: [{ startTime: 2_000_000_000, endTime: 2_000_007_200 }],
    locationType: "ph2",
    location: "Apollo Theatre",
    displayType: "all",
    postTypeIds: [5],
    sponsors: ["Apollo Theater"],
    website: "https://apollooberlin.com",
    imageCdnUrl: "https://example.com/apollo.jpg",
    contactEmail: "apollo@example.com",
    phone: "440-555-0100",
    calendarSourceUrl: "https://example.com/apollo/showtimes",
  };

  it("accepts a complete persisted event at the final publish boundary", () => {
    assert.deepEqual(
      storedEventIssues({
        eventType: "ot",
        title: "Community Art Workshop",
        description: "Neighbors can learn printmaking techniques from local artists.",
        extendedDescription:
          "The workshop welcomes beginners and provides the materials needed to participate.",
        sessions: [{ startTime: 2_000_000_000, endTime: 2_000_007_200 }],
        locationType: "ph2",
        location: "Example Arts Center",
        displayType: "all",
        postTypeIds: [89],
        sponsors: ["Example Arts Center"],
        website: "https://example.com/events/art-workshop",
        imageCdnUrl: "https://example.com/images/art-workshop.jpg",
        contactEmail: "events@example.com",
        phone: "440-555-0100",
        calendarSourceUrl: "https://example.com/events/art-workshop",
      }),
      [],
    );
  });

  it("blocks incomplete persisted data instead of trusting an earlier validation", () => {
    const issues = storedEventIssues({
      eventType: "ot",
      title: "Incomplete Event",
      description: "Too short",
      sessions: "not-an-array",
      locationType: "ph2",
      postTypeIds: "not-an-array",
      sponsors: null,
    });

    assert.deepEqual(issues, [
      "description_too_short",
      "sponsors_missing",
      "image_missing",
      "website_missing",
      "contact_email_missing",
      "phone_missing",
      "post_type_missing",
      "sessions_missing",
      "location_required",
      "display_type_invalid",
    ]);
  });

  it("blocks invalid persisted enum values instead of silently defaulting them", () => {
    const issues = storedEventIssues({
      eventType: "bad",
      title: "Community Art Workshop",
      description: "Neighbors can learn printmaking techniques from local artists.",
      sessions: [{ startTime: 2_000_000_000, endTime: 2_000_007_200 }],
      locationType: "bad",
      displayType: "bad",
      postTypeIds: [89],
      sponsors: ["Example Arts Center"],
      website: "https://example.com/events/art-workshop",
      imageCdnUrl: "https://example.com/images/art-workshop.jpg",
      contactEmail: "events@example.com",
      phone: "440-555-0100",
    });

    assert.ok(issues.includes("event_type_invalid"));
    assert.ok(issues.includes("location_type_invalid"));
    assert.ok(issues.includes("display_type_invalid"));
  });

  it("allows an inline date only in Apollo announcement short descriptions", () => {
    assert.deepEqual(
      storedEventIssues(
        dateBearingAnnouncement,
        validationOptionsForSource(
          { slug: "apollo-theater" },
          { slug: "oberlin" },
          "an",
        ),
      ),
      [],
    );
  });

  it("keeps the date rule for non-Apollo sources and non-announcement Apollo events", () => {
    assert.ok(storedEventIssues(dateBearingAnnouncement).includes("description_contains_date"));
    assert.ok(
      storedEventIssues(
        dateBearingAnnouncement,
        validationOptionsForSource(
          { slug: "another-theater" },
          { slug: "oberlin" },
          "an",
        ),
      ).includes("description_contains_date"),
    );
    assert.ok(
      storedEventIssues(
        { ...dateBearingAnnouncement, eventType: "ot" },
        validationOptionsForSource(
          { slug: "apollo-theater" },
          { slug: "oberlin" },
          "ot",
        ),
      ).includes("description_contains_date"),
    );
  });

  it("still blocks dates in Apollo long descriptions and cannot be bypassed by display name", () => {
    const options = validationOptionsForSource(
      { slug: "apollo-theater" },
      { slug: "oberlin" },
      "an",
    );
    const issues = storedEventIssues(
      {
        ...dateBearingAnnouncement,
        extendedDescription: "Tickets go on sale August 7.",
        calendarSourceName: "Apollo Theater",
      },
      options,
    );
    assert.deepEqual(issues, ["long_description_contains_date"]);
    assert.ok(
      storedEventIssues({ ...dateBearingAnnouncement, calendarSourceName: "Apollo Theater" })
        .includes("description_contains_date"),
    );
    assert.ok(
      storedEventIssues(
        {
          ...dateBearingAnnouncement,
          description: "The Fantastic Four opens August 7; visit https://example.com.",
        },
        options,
      ).includes("description_contains_url"),
    );
  });

  it("does not grant the exception to another community or a similar source slug", () => {
    for (const options of [
      validationOptionsForSource(
        { slug: "apollo-theater" },
        { slug: "cleveland" },
        "an",
      ),
      validationOptionsForSource(
        { slug: "apollo-theater-copy" },
        { slug: "oberlin" },
        "an",
      ),
    ]) {
      assert.ok(
        storedEventIssues(dateBearingAnnouncement, options).includes(
          "description_contains_date",
        ),
      );
    }
  });
});

describe("registration publishing", () => {
  it("adds a registration button while preserving existing buttons", () => {
    const buttons = [{ title: "Details", link: "https://example.com/event" }];

    assert.deepEqual(buttonsWithRegistration(buttons, "https://example.com/register"), [
      ...buttons,
      { title: "Register", link: "https://example.com/register" },
    ]);
  });

  it("does not duplicate an equivalent button link", () => {
    const buttons = [{ title: "Buy tickets", link: "https://example.com/register" }];
    const result = buttonsWithRegistration(buttons, "https://example.com/register");

    assert.strictEqual(result, buttons);
    assert.deepEqual(result, buttons);
  });

  it("leaves buttons unchanged when no registration URL exists", () => {
    const buttons = [{ title: "Details", link: "https://example.com/event" }];
    assert.strictEqual(buttonsWithRegistration(buttons, null), buttons);
  });
});

describe("submission retry policy", () => {
  it("blocks states that may already have reached the destination", () => {
    assert.equal(submissionBlocksRetry("sending"), true);
    assert.equal(submissionBlocksRetry("accepted_unreconciled"), true);
  });

  it("allows safe retry states", () => {
    for (const state of [null, undefined, "not_sent", "failed", "rejected", "accepted"]) {
      assert.equal(submissionBlocksRetry(state), false, String(state));
    }
  });
});

describe("published image boundary", () => {
  it("only exposes an application-hosted URL after image bytes are stored", () => {
    assert.equal(
      publishedImageUrl(7, null, "https://calendar.example.com/", "signed"),
      undefined,
    );
    assert.equal(
      publishedImageUrl(7, "base64-image-bytes", "https://calendar.example.com/", "signed"),
      "https://calendar.example.com/api/events/7/image.jpg?publish_token=signed",
    );
  });
});

describe("lookahead session filtering", () => {
  const nowSeconds = 2_000_000_000;
  const day = 24 * 60 * 60;

  it("keeps ongoing and in-window sessions and removes ended or later occurrences", () => {
    const sessions = [
      { startTime: nowSeconds - 200, endTime: nowSeconds - 1 },
      { startTime: nowSeconds - 200, endTime: nowSeconds },
      { startTime: nowSeconds + day, endTime: nowSeconds + day + 3_600 },
      { startTime: nowSeconds + 14 * day, endTime: nowSeconds + 14 * day + 3_600 },
      { startTime: nowSeconds + 14 * day + 1, endTime: nowSeconds + 14 * day + 3_601 },
    ];

    assert.deepEqual(sessionsWithinLookahead(sessions, 14, nowSeconds), sessions.slice(1, 4));
  });

  it("defaults invalid horizons to 14 days and caps oversized horizons at 365 days", () => {
    const sessions = [
      { startTime: nowSeconds + 14 * day, endTime: nowSeconds + 14 * day + 1 },
      { startTime: nowSeconds + 14 * day + 1, endTime: nowSeconds + 14 * day + 2 },
      { startTime: nowSeconds + 365 * day, endTime: nowSeconds + 365 * day + 1 },
      { startTime: nowSeconds + 365 * day + 1, endTime: nowSeconds + 365 * day + 2 },
    ];

    assert.deepEqual(sessionsWithinLookahead(sessions, 0, nowSeconds), [sessions[0]]);
    assert.deepEqual(sessionsWithinLookahead(sessions, 10_000, nowSeconds), sessions.slice(0, 3));
  });
});

describe("event expiry boundary", () => {
  it("uses the latest session end rather than the latest session start", () => {
    const event = {
      sessions: [
        { startTime: 100, endTime: 1_000 },
        { startTime: 900, endTime: 950 },
      ],
    } as ExtractedEvent;

    assert.equal(maxEndTime(event), 1_000);
    assert.equal(maxEndTime({ sessions: [] } as unknown as ExtractedEvent), null);
  });
});

describe("recurrence wording is not a date", () => {
  const base = {
    eventType: "ot",
    title: "Slow Train Cafe Trivia Night",
    sessions: [{ startTime: 2_000_000_000, endTime: 2_000_007_200 }],
    locationType: "ph2",
    location: "55 East College St., Oberlin, OH 44074",
    displayType: "all",
    postTypeIds: [5],
    sponsors: ["Slow Train Cafe"],
    website: "https://www.slowtraincafe.com",
    imageCdnUrl: "https://example.com/trivia.jpg",
    contactEmail: "director@oberlinbusinesspartnership.com",
    phone: "440-774-6262",
    calendarSourceUrl: "https://www.oberlinbusinesspartnership.com/events/trivia-night/",
  };

  it("accepts the recurrence phrasing that blocked a reviewer", () => {
    // The exact text from event 1594, reported by a reviewer as wrongly flagged.
    const issues = storedEventIssues({
      ...base,
      description:
        "Grab a cookie, beverage and a friend and come play Trivia with us every Thursday evening.",
    });
    assert.deepEqual(issues, []);
  });

  it("accepts other ways of saying an event repeats", () => {
    for (const description of [
      "Join us every Friday for storytime in the children's room downstairs.",
      "A drop-in maker session held Thursdays in the community workshop space.",
      "The galleries are open Tuesday through Sunday for self-guided visits.",
    ]) {
      assert.deepEqual(storedEventIssues({ ...base, description }), [], description);
    }
  });

  it("still refuses a specific date or clock time", () => {
    for (const description of [
      "The competition final takes place Thursday, August 6 in Warner Concert Hall.",
      "Doors open Thursday at 2:30 p.m. for the afternoon screening.",
      "Tickets go on sale September 8 for all remaining performances.",
      "The ensemble performs at 7:30 p.m. in the main hall.",
    ]) {
      assert.deepEqual(
        storedEventIssues({ ...base, description }),
        ["description_contains_date"],
        description,
      );
    }
  });
});

describe("publishing blocks on hard issues only", () => {
  const softOnly = {
    eventType: "ot",
    title: "Concert: Oberlin Orchestra",
    // A date in the long description is a soft issue: the reviewer sees it
    // flagged, and their approval is allowed to stand over it.
    description: "The Oberlin Orchestra performs works by Ravel and Sibelius in Finney Chapel.",
    extendedDescription: "The programme repeats Thursday, August 6 for visiting families.",
    sessions: [{ startTime: 2_000_000_000, endTime: 2_000_007_200 }],
    locationType: "ph2",
    location: "90 North Professor Street, Oberlin, OH 44074",
    displayType: "all",
    postTypeIds: [8],
    sponsors: ["Oberlin College"],
    website: "https://www.oberlin.edu",
    imageCdnUrl: "https://example.com/orchestra.jpg",
    contactEmail: "conpro@oberlin.edu",
    phone: "440-775-8610",
    calendarSourceUrl: "https://www.oberlin.edu/events/orchestra",
  };

  const blocking = (issues: string[]) =>
    issues.filter((issue) => HARD_ISSUES.has(issue) || issue.endsWith("_invalid"));

  it("reports the soft issue but does not let it veto publishing", () => {
    const issues = storedEventIssues(softOnly);
    assert.deepEqual(issues, ["long_description_contains_date"]);
    assert.deepEqual(blocking(issues), []);
  });

  it("still refuses an event that is genuinely unpublishable", () => {
    const issues = storedEventIssues({ ...softOnly, imageCdnUrl: null, contactEmail: null });
    assert.ok(blocking(issues).includes("image_missing"));
    assert.ok(blocking(issues).includes("contact_email_missing"));
  });

  it("still refuses corrupt enum values", () => {
    const issues = storedEventIssues({ ...softOnly, locationType: "nonsense" });
    assert.ok(blocking(issues).includes("location_type_invalid"));
  });
});
