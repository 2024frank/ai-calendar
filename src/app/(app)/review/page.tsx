import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { duplicatesQueue, eventsForTab, listSources, reviewQueue } from "@/lib/data";
import { fmtDate } from "@/components/bits";
import { EVENT_TYPES } from "@/lib/taxonomy";
import { ReviewFilters } from "./ReviewFilters";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "pending", label: "Pending events" },
  { key: "duplicates", label: "Duplicates" },
  { key: "rejected", label: "Rejected" },
  { key: "approved", label: "Approved" },
  { key: "submitted", label: "Submitted" },
] as const;

// Short names for the queue badge, so a reviewer sees WHAT is needed at a glance.
const SHORT_ISSUE: Record<string, string> = {
  title_missing: "title",
  title_too_long: "shorter title",
  description_too_short: "description",
  description_too_long: "shorter description",
  sponsors_missing: "sponsor",
  image_missing: "image",
  website_missing: "website",
  contact_email_missing: "contact email",
  phone_missing: "phone",
  post_type_missing: "category",
  post_type_invalid: "category",
  sessions_missing: "dates",
  session_start_invalid: "date",
  session_end_before_start: "end time",
  location_required: "location",
  url_link_required: "online link",
  missing_registration_required_text: '"Registration required." in description',
  description_contains_url: "URL out of description",
  long_description_contains_url: "URL out of long description",
  long_description_ambiguous_location: "venue name in long description",
};

function needsList(reason: string | null): string | null {
  if (!reason || !reason.startsWith("Missing before publish:")) return null;
  const names = reason
    .slice("Missing before publish:".length)
    .split(",")
    .map((c) => SHORT_ISSUE[c.trim()] ?? c.trim())
    .filter(Boolean);
  if (!names.length) return null;
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
}

function firstSessionDate(sessions: unknown): string {
  if (!Array.isArray(sessions) || sessions.length === 0) return "—";
  const start = (sessions[0] as { startTime?: number })?.startTime;
  if (!start) return "—";
  // Always Oberlin time, never the viewer's own timezone.
  return new Date(start * 1000).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const typeLabel = (v: string | null) => EVENT_TYPES.find((t) => t.value === v)?.label ?? "—";

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; source?: string; type?: string; q?: string }>;
}) {
  const s = await requireUser();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "pending";
  const filter = {
    sourceId: sp.source ? Number(sp.source) : undefined,
    eventType: sp.type || undefined,
    q: sp.q || undefined,
  };

  const srcs = await listSources(s);
  const rows =
    tab === "duplicates"
      ? await duplicatesQueue(s, filter)
      : tab === "rejected"
        ? await eventsForTab(s, ["rejected", "auto_rejected"], filter)
        : tab === "approved"
          ? await eventsForTab(s, ["approved"], filter)
          : tab === "submitted"
            ? await eventsForTab(s, ["submitted"], filter)
            : await reviewQueue(s, filter);

  const sourceName = new Map(srcs.map((x) => [x.id, x.name]));
  const lastCol = tab === "duplicates" ? "Duplicate of" : tab === "pending" ? "Added" : "Status";

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div>
        <div className="page-title">Pending events</div>
        <div className="muted">
          Open an event to check it, fix anything wrong, then approve or reject. Your decisions train
          the agent.
        </div>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {TABS.map((t) => {
          const qs = new URLSearchParams();
          if (t.key !== "pending") qs.set("tab", t.key);
          if (sp.source) qs.set("source", sp.source);
          if (sp.type) qs.set("type", sp.type);
          if (sp.q) qs.set("q", sp.q);
          return (
            <Link
              key={t.key}
              className={`btn ${tab === t.key ? "primary" : ""}`}
              href={`/review${qs.toString() ? `?${qs}` : ""}`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <ReviewFilters sources={srcs.map((x) => ({ id: x.id, name: x.name }))} />

      <div className="card" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Event</th>
              <th>Source</th>
              <th>Type</th>
              <th>When</th>
              <th>Location</th>
              <th>{lastCol}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 20 }}>
                  {tab === "duplicates"
                    ? "No duplicates found yet. Events that repeat an existing one land here."
                    : tab === "rejected"
                      ? "Nothing rejected. Incomplete events the agent could not complete land here."
                      : tab === "pending"
                        ? "Nothing waiting for review."
                        : "Nothing here yet."}
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/review/${e.id}`} style={{ color: "var(--accent)", fontWeight: 600 }}>
                    {e.title ?? "(untitled)"}
                  </Link>
                  {tab === "pending" && needsList(e.rejectionReason) && (
                    <div className="badge warn" style={{ marginTop: 4 }}>
                      needs: {needsList(e.rejectionReason)}
                    </div>
                  )}
                </td>
                <td className="muted">{sourceName.get(e.sourceId ?? -1) ?? "—"}</td>
                <td className="muted">{typeLabel(e.eventType)}</td>
                <td>{firstSessionDate(e.sessions)}</td>
                <td className="muted">
                  {(e.location ?? "").slice(0, 30) || (e.locationType === "on" ? "Online" : "—")}
                </td>
                <td className="muted">
                  {tab === "duplicates"
                    ? e.duplicateOfEventId
                      ? `#${e.duplicateOfEventId}`
                      : "—"
                    : tab === "pending"
                      ? fmtDate(e.createdAt)
                      : e.status.replace(/_/g, " ")}
                </td>
                <td>
                  <Link className="btn" href={`/review/${e.id}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
