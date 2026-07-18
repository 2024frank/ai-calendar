import { createHash } from "crypto";

/** CommunityHub post-type taxonomy (destination config mirrors this). */
export const POST_TYPES: Record<number, string> = {
  1: "Volunteer Opportunity",
  2: "Exhibit",
  3: "Fair, Festival, or Public Celebration",
  4: "Tour, Walking Tours or Open House",
  5: "Film",
  6: "Presentation or Lecture",
  7: "Workshop or Class",
  8: "Music Performance",
  9: "Theatre or Dance",
  10: "City Government",
  11: "Spectator Sport",
  12: "Participatory Sport or Game",
  13: "Networking Event",
  59: "Ecolympics or Environmental",
  89: "Other",
};
export const POST_TYPE_IDS = Object.keys(POST_TYPES).map(Number);

export type Session = { startTime: number; endTime: number };
export type ExtractedEvent = {
  eventType: "ot" | "an" | "jp";
  title: string;
  description: string;
  extendedDescription?: string | null;
  sessions: Session[];
  locationType: "ph2" | "on" | "bo" | "ne";
  location?: string | null;
  urlLink?: string | null;
  display: "all" | "ps" | "sps" | "ss";
  postTypeId: number[];
  sponsors: string[];
  website?: string | null;
  registrationUrl?: string | null;
  imageCdnUrl?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  cost?: string | null;
};

/**
 * The one normalized-event contract both agents know.
 * Rules carried over verbatim from the July 16 requirements.
 */
export const NORMALIZED_EVENT_CONTRACT = `
Return real events only. Never invent facts that are not in the source content.

FIELDS
- eventType: "ot" (event), "an" (announcement), or "jp" (job). Never any other value.
- title: 1-60 characters.
- description: SHORT description, 10-200 characters, one or two sentences.
- extendedDescription: optional, up to 1000 characters.
- sessions: at least one { startTime, endTime } as INTEGER Unix seconds (not milliseconds), in America/New_York.
- locationType: "ph2" physical only, "on" online only, "bo" both, "ne" neither.
- location: required when locationType is "ph2" or "bo" (street address or venue address).
- urlLink: required when locationType is "on" or "bo".
- display: "all".
- postTypeId: one or more category ids from this exact list, nothing else:
${POST_TYPE_IDS.map((id) => `  ${id} = ${POST_TYPES[id]}`).join("\n")}
- sponsors: at least one organization name (the hosting organization).
- website, registrationUrl, imageCdnUrl, contactEmail, phone: include when the source supports them.

TITLE RULES
- Announcements ("an") must have an ACTION-oriented title: "Register for...", "Participate in...", "Apply for...", "Recycle...". Never a bare noun when the source is announcing an opportunity. Never invent an action the source does not support.

DESCRIPTION RULES
- If the event has a valid registration URL, the short description MUST end with "Registration required."
- If the event has a cost, the short description MUST include "Paid event."
- Put the registration URL in registrationUrl, never inside the long description.
- The long description must NOT contain URLs or the street address, must not repeat what already belongs in dedicated fields, and must not use vague words like "here" or "there". Use the real venue name.
- If the whole source description fits within 200 characters, use it as the short description and omit extendedDescription entirely. Never write filler just to fill a field.
- Never use em dashes or en dashes. Never put dates or times inside the description.

DUPLICATES
- Duplicate checking is done by content, especially the DATE and the LOCATION. Do not compare ids.
`.trim();

/** JSON schema used for the structured-output turn. */
export const EVENTS_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          eventType: { type: "string", enum: ["ot", "an", "jp"] },
          title: { type: "string" },
          description: { type: "string" },
          extendedDescription: { type: ["string", "null"] },
          sessions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                startTime: { type: "integer" },
                endTime: { type: "integer" },
              },
              required: ["startTime", "endTime"],
              additionalProperties: false,
            },
          },
          locationType: { type: "string", enum: ["ph2", "on", "bo", "ne"] },
          location: { type: ["string", "null"] },
          urlLink: { type: ["string", "null"] },
          display: { type: "string", enum: ["all", "ps", "sps", "ss"] },
          postTypeId: { type: "array", items: { type: "integer" } },
          sponsors: { type: "array", items: { type: "string" } },
          website: { type: ["string", "null"] },
          registrationUrl: { type: ["string", "null"] },
          imageCdnUrl: { type: ["string", "null"] },
          contactEmail: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          cost: { type: ["string", "null"] },
        },
        required: [
          "eventType",
          "title",
          "description",
          "sessions",
          "locationType",
          "display",
          "postTypeId",
          "sponsors",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["events"],
  additionalProperties: false,
} as const;

const DASHES = /[–—]/g;

function clean(s: unknown): string {
  return String(s ?? "")
    .replace(DASHES, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Deterministic normalization applied before validation. */
export function normalizeEvent(raw: Record<string, unknown>): ExtractedEvent {
  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : [])
    .map((s) => {
      const o = s as Record<string, unknown>;
      let start = Number(o.startTime);
      let end = Number(o.endTime);
      // Reject millisecond timestamps (13 digits) by converting down.
      if (start > 1e12) start = Math.floor(start / 1000);
      if (end > 1e12) end = Math.floor(end / 1000);
      return { startTime: start, endTime: end };
    })
    .filter((s) => Number.isFinite(s.startTime) && s.startTime > 0);

  const postTypeId = (Array.isArray(raw.postTypeId) ? raw.postTypeId : [])
    .map((n) => Number(n))
    .filter((n) => POST_TYPE_IDS.includes(n));

  const sponsors = (Array.isArray(raw.sponsors) ? raw.sponsors : [])
    .map((s) => clean(s))
    .filter(Boolean);

  const ext = clean(raw.extendedDescription);

  return {
    eventType: (["ot", "an", "jp"].includes(String(raw.eventType)) ? raw.eventType : "ot") as
      | "ot"
      | "an"
      | "jp",
    title: clean(raw.title).slice(0, 60),
    description: clean(raw.description),
    extendedDescription: ext ? ext.slice(0, 1000) : null,
    sessions,
    locationType: (["ph2", "on", "bo", "ne"].includes(String(raw.locationType))
      ? raw.locationType
      : "ne") as "ph2" | "on" | "bo" | "ne",
    location: clean(raw.location) || null,
    urlLink: clean(raw.urlLink) || null,
    display: "all",
    postTypeId: postTypeId.length ? Array.from(new Set(postTypeId)) : [89],
    sponsors,
    website: clean(raw.website) || null,
    registrationUrl: clean(raw.registrationUrl) || null,
    imageCdnUrl: clean(raw.imageCdnUrl) || null,
    contactEmail: clean(raw.contactEmail) || null,
    phone: clean(raw.phone) || null,
    cost: clean(raw.cost) || null,
  };
}

/** Deterministic validation. Hard failures block publishing (event goes to review). */
export function validateEvent(e: ExtractedEvent): string[] {
  const issues: string[] = [];
  if (!e.title || e.title.length < 1) issues.push("title_missing");
  if (e.title.length > 60) issues.push("title_too_long");
  if (!e.description || e.description.length < 10) issues.push("description_too_short");
  if (e.description.length > 200) issues.push("description_too_long");
  if (!e.sponsors.length) issues.push("sponsors_missing");
  if (!e.postTypeId.length) issues.push("post_type_missing");
  if (e.postTypeId.some((id) => !POST_TYPE_IDS.includes(id))) issues.push("post_type_invalid");
  if (!e.sessions.length) issues.push("sessions_missing");
  for (const s of e.sessions) {
    if (!Number.isInteger(s.startTime) || s.startTime <= 0) issues.push("session_start_invalid");
    if (s.endTime < s.startTime) issues.push("session_end_before_start");
    if (e.eventType !== "an" && s.endTime === s.startTime) issues.push("end_equals_start");
  }
  if ((e.locationType === "ph2" || e.locationType === "bo") && !e.location)
    issues.push("location_required");
  if ((e.locationType === "on" || e.locationType === "bo") && !e.urlLink)
    issues.push("url_link_required");
  if (e.registrationUrl && !/Registration required\.$/.test(e.description))
    issues.push("missing_registration_required_text");
  if (e.extendedDescription && /https?:\/\//i.test(e.extendedDescription))
    issues.push("long_description_contains_url");
  if (e.extendedDescription && /\b(here|there)\b/i.test(e.extendedDescription))
    issues.push("long_description_ambiguous_location");
  return issues;
}

/** Latest session start, used for the expiry sweep. */
export function maxStartTime(e: ExtractedEvent): number | null {
  if (!e.sessions.length) return null;
  return Math.max(...e.sessions.map((s) => s.startTime));
}

/** Same-source dedup signature: normalized title + session windows. */
export function computeDedupKey(e: ExtractedEvent): string {
  const title = e.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const windows = e.sessions
    .map((s) => `${s.startTime}-${s.endTime}`)
    .sort()
    .join(",");
  const basis =
    e.eventType === "an"
      ? `${title}::${e.description.toLowerCase()}::${windows}`
      : `${title}::${windows}`;
  return createHash("sha256").update(basis).digest("hex");
}

/** Content match used to flag duplicates: date and location first, then title. */
export function contentMatches(
  a: { title: string; startTimes: number[]; location: string | null },
  b: { title: string; startTimes: number[]; location: string | null },
): { match: boolean; reason: string } {
  const sameDay = a.startTimes.some((x) =>
    b.startTimes.some((y) => Math.abs(x - y) < 12 * 3600),
  );
  const normLoc = (s: string | null) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sameLoc =
    normLoc(a.location) && normLoc(b.location)
      ? normLoc(a.location) === normLoc(b.location) ||
        normLoc(a.location).includes(normLoc(b.location)) ||
        normLoc(b.location).includes(normLoc(a.location))
      : false;
  const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sameTitle = normTitle(a.title) === normTitle(b.title);

  if (sameDay && sameTitle) return { match: true, reason: "same date and title" };
  if (sameDay && sameLoc) return { match: true, reason: "same date and location" };
  return { match: false, reason: "" };
}
