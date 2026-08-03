import {
  validateEvent,
  type EventValidationOptions,
  type ExtractedEvent,
} from "./contract";

type StoredEvent = {
  eventType?: string | null;
  title?: string | null;
  description?: string | null;
  extendedDescription?: string | null;
  sessions?: unknown;
  locationType?: string | null;
  location?: string | null;
  urlLink?: string | null;
  displayType?: string | null;
  postTypeIds?: unknown;
  sponsors?: unknown;
  website?: string | null;
  registrationUrl?: string | null;
  imageCdnUrl?: string | null;
  imageData?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  // Reviewer-editable provenance, intentionally ignored by source policy.
  calendarSourceName?: string | null;
  calendarSourceUrl?: string | null;
};

/** Revalidate persisted data at the final trust boundary before publishing. */
export function storedEventIssues(
  ev: StoredEvent,
  options: EventValidationOptions = {},
): string[] {
  const eventTypes = ["ot", "an", "jp"];
  const locationTypes = ["ph2", "on", "bo", "ne"];
  const displayTypes = ["all", "ps", "sps", "ss"];
  const candidate: ExtractedEvent = {
    eventType: (eventTypes.includes(ev.eventType ?? "") ? ev.eventType : "ot") as
      | "ot"
      | "an"
      | "jp",
    title: ev.title ?? "",
    description: ev.description ?? "",
    extendedDescription: ev.extendedDescription ?? null,
    sessions: Array.isArray(ev.sessions)
      ? (ev.sessions as { startTime: number; endTime: number }[])
      : [],
    locationType: (locationTypes.includes(ev.locationType ?? "")
      ? ev.locationType
      : "ne") as "ph2" | "on" | "bo" | "ne",
    location: ev.location ?? null,
    urlLink: ev.urlLink ?? null,
    display: (displayTypes.includes(ev.displayType ?? "")
      ? ev.displayType
      : "all") as "all" | "ps" | "sps" | "ss",
    postTypeId: Array.isArray(ev.postTypeIds) ? (ev.postTypeIds as number[]) : [],
    sponsors: Array.isArray(ev.sponsors) ? (ev.sponsors as string[]) : [],
    website: ev.website ?? null,
    registrationUrl: ev.registrationUrl ?? null,
    imageCdnUrl: ev.imageCdnUrl ?? null,
    imageData: ev.imageData ?? null,
    contactEmail: ev.contactEmail ?? null,
    phone: ev.phone ?? null,
    calendarSourceUrl: ev.calendarSourceUrl ?? null,
  };
  const issues = validateEvent(candidate, options);
  if (!eventTypes.includes(ev.eventType ?? "")) issues.push("event_type_invalid");
  if (!locationTypes.includes(ev.locationType ?? "")) issues.push("location_type_invalid");
  if (!displayTypes.includes(ev.displayType ?? "")) issues.push("display_type_invalid");
  return issues;
}

export function buttonsWithRegistration(
  buttons: { title: string; link: string }[],
  registrationUrl: string | null | undefined,
): { title: string; link: string }[] {
  if (!registrationUrl || buttons.some((button) => button.link === registrationUrl)) return buttons;
  return [...buttons, { title: "Register", link: registrationUrl }];
}

/**
 * Only images stored by this application may cross the publishing boundary.
 * Remote source URLs are fetched and converted before buildPayload is called.
 */
export function publishedImageUrl(
  eventId: number,
  imageData: string | null | undefined,
  appUrl: string,
  publishToken: string,
): string | undefined {
  if (!imageData) return undefined;
  return `${appUrl.replace(/\/+$/, "")}/api/events/${eventId}/image.jpg?publish_token=${encodeURIComponent(publishToken)}`;
}

export function submissionBlocksRetry(state: string | null | undefined): boolean {
  return state === "sending" || state === "accepted_unreconciled";
}
