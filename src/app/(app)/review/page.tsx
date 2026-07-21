import Link from "next/link";
import { isAdmin, requireUser } from "@/lib/auth";
import { duplicatesQueue, eventsForTab, listSources, reviewQueue } from "@/lib/data";
import { EventStatus, fmtDate } from "@/components/bits";
import { ButtonLink, Card, EmptyState, PageHeader, StatusBadge, TableShell } from "@/components/ui";
import { EVENT_TYPES } from "@/lib/taxonomy";
import { ReviewFilters } from "./ReviewFilters";
import { FixAllButton } from "./FixAllButton";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "duplicates", label: "Duplicates" },
  { key: "rejected", label: "Rejected" },
  { key: "approved", label: "Approved" },
  { key: "submitted", label: "Submitted" },
] as const;

const SHORT_ISSUE: Record<string, string> = {
  title_missing: "title", title_too_long: "shorter title", description_too_short: "description",
  description_too_long: "shorter description", sponsors_missing: "sponsor", image_missing: "image",
  website_missing: "website", contact_email_missing: "contact email", phone_missing: "phone",
  post_type_missing: "category", post_type_invalid: "category", sessions_missing: "dates",
  session_start_invalid: "date", session_end_before_start: "end time", location_required: "location",
  url_link_required: "online link", missing_registration_required_text: "registration note",
  description_contains_url: "URL removed from description", description_is_title: "full description",
  long_description_contains_url: "URL removed from long description", long_description_ambiguous_location: "venue name",
};

function needsList(reason: string | null): string | null {
  if (!reason?.startsWith("Missing before publish:")) return null;
  const names = reason.slice("Missing before publish:".length).split(",").map((code) => SHORT_ISSUE[code.trim()] ?? code.trim()).filter(Boolean);
  if (!names.length) return null;
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
}

const sessionFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

function firstSessionDate(sessions: unknown): string {
  if (!Array.isArray(sessions) || sessions.length === 0) return "—";
  const start = (sessions[0] as { startTime?: number })?.startTime;
  return start ? sessionFormatter.format(new Date(start * 1000)) : "—";
}

const typeLabel = (value: string | null) => EVENT_TYPES.find((type) => type.value === value)?.label ?? "—";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ tab?: string; source?: string; type?: string; q?: string }> }) {
  const session = await requireUser();
  const params = await searchParams;
  const tab = TABS.find((item) => item.key === params.tab)?.key ?? "pending";
  const filter = { sourceId: params.source ? Number(params.source) : undefined, eventType: params.type || undefined, q: params.q || undefined };
  const sources = await listSources(session);
  const rows = tab === "duplicates" ? await duplicatesQueue(session, filter)
    : tab === "rejected" ? await eventsForTab(session, ["rejected", "auto_rejected"], filter)
      : tab === "approved" ? await eventsForTab(session, ["approved"], filter)
        : tab === "submitted" ? await eventsForTab(session, ["submitted"], filter)
          : await reviewQueue(session, filter);
  const sourceName = new Map(sources.map((source) => [source.id, source.name]));
  const activeLabel = TABS.find((item) => item.key === tab)?.label ?? "Pending";

  const emptyCopy = tab === "duplicates" ? "No duplicate events match these filters."
    : tab === "rejected" ? "No rejected events match these filters."
      : tab === "pending" ? "You’re all caught up. New extracted events will appear here."
        : `No ${activeLabel.toLowerCase()} events match these filters.`;

  return (
    <div className="grid" style={{ gap: 20 }}>
      <PageHeader eyebrow="Quality Control" title="Review Queue" description="Check extracted event details, correct issues, and publish with confidence." />

      <nav className="tabs" aria-label="Event status">
        {TABS.map((item) => {
          const query = new URLSearchParams();
          if (item.key !== "pending") query.set("tab", item.key);
          if (params.source) query.set("source", params.source);
          if (params.type) query.set("type", params.type);
          if (params.q) query.set("q", params.q);
          return <ButtonLink key={item.key} size="sm" variant={tab === item.key ? "primary" : "ghost"} href={`/review${query.size ? `?${query}` : ""}`}>{item.label}</ButtonLink>;
        })}
      </nav>

      <ReviewFilters sources={sources.map((source) => ({ id: source.id, name: source.name }))} />

      {tab === "rejected" && isAdmin(session) && (
        <FixAllButton initialCount={rows.filter((r) => r.status === "auto_rejected").length} />
      )}

      <Card className="surface--flush">
        <div className="section-header" style={{ padding: "18px 20px 4px" }}>
          <div><h2>{activeLabel} Events</h2><p>{rows.length} {rows.length === 1 ? "event" : "events"}</p></div>
        </div>
        {rows.length === 0 ? <EmptyState title="Nothing to Review" description={emptyCopy} /> : (
          <TableShell label={`${activeLabel} events`}>
            <table className="tbl">
              <thead><tr><th>Event</th><th>Source</th><th>Type</th><th>When</th><th>Location</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {rows.map((event) => {
                  const needs = tab === "pending" ? needsList(event.rejectionReason) : null;
                  return (
                    <tr key={event.id}>
                      <td style={{ maxWidth: 300 }}>
                        <Link href={`/review/${event.id}`} className="table-link">{event.title || "Untitled Event"}</Link>
                        {needs && <div style={{ marginTop: 5 }}><StatusBadge tone="warning">Needs {needs}</StatusBadge></div>}
                      </td>
                      <td className="muted">{sourceName.get(event.sourceId ?? -1) ?? "—"}</td>
                      <td className="muted">{typeLabel(event.eventType)}</td>
                      <td>{firstSessionDate(event.sessions)}</td>
                      <td className="muted">{(event.location ?? "").slice(0, 36) || (event.locationType === "on" ? "Online" : "—")}</td>
                      <td>{tab === "duplicates" && event.duplicateOfEventId ? <StatusBadge tone="neutral">Duplicate of #{event.duplicateOfEventId}</StatusBadge> : tab === "pending" ? <span className="muted">{fmtDate(event.createdAt)}</span> : <EventStatus status={event.status} />}</td>
                      <td><ButtonLink href={`/review/${event.id}`} size="sm" icon="arrow-right">Open</ButtonLink></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
