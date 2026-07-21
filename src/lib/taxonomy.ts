/** Browser-safe shared constants (no Node imports). */

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

export const EVENT_TYPES = [
  { value: "ot", label: "Event" },
  { value: "an", label: "Announcement" },
  { value: "jp", label: "Job" },
] as const;

export const LOCATION_TYPES = [
  { value: "ph2", label: "In person" },
  { value: "on", label: "Online" },
  { value: "bo", label: "In person and online" },
  { value: "ne", label: "No location" },
] as const;

export const DISPLAY_TYPES = [
  { value: "all", label: "All public screens" },
  { value: "ps", label: "School screens" },
  { value: "sps", label: "School + public screens" },
  { value: "ss", label: "Specific screens" },
] as const;

export const GEO_SCOPES = [
  { value: "hyper_local", label: "Hyper-local" },
  { value: "city_wide", label: "City-wide" },
  { value: "county", label: "County" },
  { value: "regional", label: "Regional" },
] as const;

/** Plain English for every validation code, so no reviewer sees raw jargon. */
export const ISSUE_LABELS: Record<string, string> = {
  title_missing: "The title is missing",
  title_too_long: "The title is longer than 60 characters",
  description_too_short: "The short description is too short",
  description_too_long: "The short description is longer than 200 characters",
  sponsors_missing: "No hosting organization was found",
  image_missing: "No picture was found for this event",
  website_missing: "The website link is missing",
  contact_email_missing: "The contact email is missing",
  phone_missing: "The phone number is missing",
  post_type_missing: "No category was chosen",
  post_type_invalid: "A category is not one CommunityHub accepts",
  sessions_missing: "No date or time was found",
  session_start_invalid: "The start date is not a real date",
  session_end_before_start: "The end time comes before the start time",
  end_equals_start: "The end time is the same as the start time, so it still needs a real end time",
  location_required: "An in-person event needs a street address",
  url_link_required: "An online event needs a link to join",
  missing_registration_required_text:
    'This event takes registrations, so the short description should end with "Registration required."',
  source_link_dead:
    "The link back to the original event page does not exist (404). The event or its link was likely fabricated",
  description_is_title:
    "The short description just restates the title. It should say what happens at the event",
  description_contains_date:
    "The short description contains a date, day, or time. Those belong only in the schedule, not the text",
  long_description_contains_date:
    "The long description contains dates or times. Remove the schedule from the text; the sessions hold it",
  description_contains_url:
    "The short description contains a link. A stream or meeting link belongs in the online event URL field",
  long_description_contains_url:
    "The long description contains a link. Links belong in the website or registration field",
  long_description_ambiguous_location:
    'The long description says "here" or "there" instead of naming the venue',
};

export function issueLabel(code: string): string {
  return ISSUE_LABELS[code] ?? code.replace(/_/g, " ");
}

/** Turn a stored reason (which may contain raw codes) into readable sentences. */
export function humanizeIssues(reason: string): string[] {
  const body = reason.replace(/^[^:]*:\s*/, "");
  return body
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map(issueLabel);
}

export const REJECT_REASONS = [
  { code: "not_an_event", label: "Not an event" },
  { code: "duplicate_missed", label: "Duplicate of an existing event" },
  { code: "wrong_date", label: "Wrong date or time" },
  { code: "wrong_location", label: "Wrong location" },
  { code: "wrong_post_type", label: "Wrong category" },
  { code: "description_wrong", label: "Description is wrong or invented" },
  { code: "title_wrong", label: "Title is wrong or unclear" },
  { code: "missing_info", label: "Required information missing" },
  { code: "other", label: "Other" },
] as const;
