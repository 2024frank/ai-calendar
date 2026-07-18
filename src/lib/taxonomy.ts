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
