"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  DISPLAY_TYPES,
  EVENT_TYPES,
  GEO_SCOPES,
  LOCATION_TYPES,
  POST_TYPES,
  POST_TYPE_IDS,
  REJECT_REASONS,
  humanizeIssues,
} from "@/lib/taxonomy";

type Session = { startTime: number; endTime: number };
type Button = { title: string; link: string };

type EventRow = {
  id: number;
  status: string;
  eventType: string | null;
  title: string | null;
  description: string | null;
  extendedDescription: string | null;
  sessions: Session[] | null;
  locationType: string | null;
  location: string | null;
  placeName: string | null;
  roomNum: string | null;
  geoScope: string | null;
  urlLink: string | null;
  displayType: string | null;
  screensIds: number[] | null;
  postTypeIds: number[] | null;
  sponsors: string[] | null;
  buttons: Button[] | null;
  website: string | null;
  registrationUrl: string | null;
  imageCdnUrl: string | null;
  hasImageData: boolean;
  contactEmail: string | null;
  phone: string | null;
  calendarSourceName: string | null;
  calendarSourceUrl: string | null;
  ingestedPostUrl: string | null;
  fieldNotes: Record<string, string> | null;
  rejectionReason: string | null;
};

/*
 * datetime-local <-> unix seconds, always in Oberlin time regardless of the
 * reviewer's own timezone. Showing a browser-local time would silently shift
 * every event for anyone not sitting in Eastern.
 */
// The community's own timezone (Oberlin is Eastern), never the viewer's.
let TZ = "America/New_York";

/** Offset (ms) of the zone at a given instant, DST included. */
function tzOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return asUtc - utcMs;
}

function toLocalInput(sec: number): string {
  if (!sec) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(sec * 1000));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${(g("hour") === "24" ? "00" : g("hour"))}:${g("minute")}`;
}

function fromLocalInput(s: string): number {
  if (!s) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return 0;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  // Treat the typed wall time as Oberlin time, then convert to a real instant.
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return Math.floor((guess - tzOffsetMs(guess)) / 1000);
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ display: "grid", gap: 14 }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
        {hint && <div className="muted" style={{ fontSize: 12 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  missing,
  children,
}: {
  label: string;
  required?: boolean;
  missing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">
        {label}
        {required && <span style={{ color: "var(--bad)", marginLeft: 4 }}>*</span>}
        {missing && <span style={{ color: "var(--bad)", marginLeft: 8, fontWeight: 500 }}>required</span>}
      </label>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          className={`badge ${value === o.value ? "good" : "neutral"}`}
          style={{ border: "none", cursor: "pointer" }}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EventReview({
  event,
  sourceName,
  publishEmail,
  timezone,
}: {
  event: EventRow;
  sourceName: string;
  publishEmail: string;
  timezone: string;
}) {
  TZ = timezone || "America/New_York";
  const router = useRouter();

  const [f, setF] = useState({
    eventType: event.eventType ?? "ot",
    title: event.title ?? "",
    description: event.description ?? "",
    extendedDescription: event.extendedDescription ?? "",
    locationType: event.locationType ?? "ne",
    location: event.location ?? "",
    placeName: event.placeName ?? "",
    roomNum: event.roomNum ?? "",
    geoScope: event.geoScope ?? "city_wide",
    urlLink: event.urlLink ?? "",
    displayType: event.displayType ?? "all",
    website: event.website ?? "",
    registrationUrl: event.registrationUrl ?? "",
    imageCdnUrl: event.imageCdnUrl ?? "",
    contactEmail: event.contactEmail ?? "",
    phone: event.phone ?? "",
    calendarSourceName: event.calendarSourceName ?? "",
    calendarSourceUrl: event.calendarSourceUrl ?? "",
  });
  const [sponsors, setSponsors] = useState<string[]>(event.sponsors?.length ? event.sponsors : [""]);
  const [sessions, setSessions] = useState<Session[]>(
    event.sessions?.length ? event.sessions : [{ startTime: 0, endTime: 0 }],
  );
  const [buttons, setButtons] = useState<Button[]>(event.buttons ?? []);
  const [cats, setCats] = useState<number[]>(event.postTypeIds ?? []);
  const [screenIds, setScreenIds] = useState<string>((event.screensIds ?? []).join(", "));

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<string>(REJECT_REASONS[0].code);
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [showPayload, setShowPayload] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  const cleanSponsors = sponsors.map((x) => x.trim()).filter(Boolean);
  const cleanSessions = sessions.filter((s) => s.startTime > 0);
  const cleanButtons = buttons.filter((b) => b.title.trim() && b.link.trim());
  const cleanScreens = screenIds
    .split(/[,\s]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);

  const needsAddress = f.locationType === "ph2" || f.locationType === "bo";
  const needsUrl = f.locationType === "on" || f.locationType === "bo";

  // Everything mandatory before approval EXCEPT the online link and registration link.
  const missing = {
    title: !f.title.trim(),
    description: f.description.trim().length < 10,
    sessions: cleanSessions.length === 0,
    location: needsAddress && !f.location.trim(),
    website: !f.website.trim(),
    imageCdnUrl: !f.imageCdnUrl.trim() && !event.hasImageData,
    contactEmail: !f.contactEmail.trim(),
    phone: !f.phone.trim(),
    sponsors: cleanSponsors.length === 0,
    cats: cats.length === 0,
    screens: f.displayType === "ss" && cleanScreens.length === 0,
  };
  const missingKeys = Object.entries(missing).filter(([, v]) => v).map(([k]) => k);
  const ready = missingKeys.length === 0;

  const payload = useMemo(
    () => ({
      eventType: f.eventType,
      // Publishing identity: who is submitting. Server-set, never the org's
      // public contact (that is contactEmail below).
      email: publishEmail,
      title: f.title.trim(),
      description: f.description.trim(),
      extendedDescription: f.extendedDescription.trim() || undefined,
      sessions: cleanSessions,
      locationType: f.locationType,
      location: needsAddress ? f.location.trim() : undefined,
      placeName: f.placeName.trim() || undefined,
      roomNum: f.roomNum.trim() || undefined,
      urlLink: needsUrl ? f.urlLink.trim() : undefined,
      display: f.displayType,
      screensIds: f.displayType === "ss" ? cleanScreens : undefined,
      postTypeId: cats,
      sponsors: cleanSponsors,
      buttons: cleanButtons.length ? cleanButtons : undefined,
      website: f.website.trim() || undefined,
      registrationUrl: f.registrationUrl.trim() || undefined,
      image_cdn_url: f.imageCdnUrl.trim() || undefined,
      contactEmail: f.contactEmail.trim() || undefined,
      phone: f.phone.trim() || undefined,
      geoScope: f.geoScope,
      calendarSourceName: f.calendarSourceName.trim() || undefined,
      calendarSourceUrl: f.calendarSourceUrl.trim() || undefined,
      ingestedPostUrl: event.ingestedPostUrl ?? undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f, sponsors, sessions, buttons, cats, screenIds],
  );

  function body() {
    return {
      ...f,
      sponsors: cleanSponsors,
      sessions: cleanSessions,
      buttons: cleanButtons,
      postTypeIds: cats,
      screensIds: cleanScreens,
    };
  }

  async function save() {
    setBusy("save");
    setMsg(null);
    const res = await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body()),
    });
    const d = await res.json();
    setBusy(null);
    setMsg(res.ok ? (d.changed ? `Saved ${d.changed} change(s). The agent learns from these.` : "No changes.") : d.error);
    if (res.ok) router.refresh();
  }

  async function approve() {
    if (!ready) {
      setShowErrors(true);
      setMsg(`Fill the ${missingKeys.length} required field(s) marked in red before approving.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setBusy("approve");
    await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body()),
    });
    const res = await fetch(`/api/events/${event.id}/approve`, { method: "POST" });
    setBusy(null);
    if (res.ok) router.push("/review");
    else setMsg("Could not approve.");
  }

  async function reject() {
    setBusy("reject");
    const res = await fetch(`/api/events/${event.id}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reasonCode: reason, note }),
    });
    setBusy(null);
    if (res.ok) router.push("/review");
    else setMsg("Could not reject.");
  }

  const m = (k: keyof typeof missing) => showErrors && missing[k];

  return (
    <div className="grid" style={{ gap: 16, gridTemplateColumns: "minmax(0,1fr) 320px", alignItems: "start" }}>
      {/* LEFT: the editor */}
      <div className="grid" style={{ gap: 16 }}>
        {!ready && (
          <div className="card" style={{ borderColor: "var(--warn)" }}>
            <div className="label">Not ready to publish</div>
            <div style={{ fontSize: 13 }}>
              {missingKeys.length} required field(s) still needed:{" "}
              {missingKeys.map((k) => LABELS[k] ?? k).join(", ")}.
            </div>
          </div>
        )}
        {event.rejectionReason && (
          <div className="card" style={{ borderColor: "var(--warn)" }}>
            <div className="label">Still needed before this can be published</div>
            <ul style={{ fontSize: 13, margin: "4px 0 0", paddingLeft: 18 }}>
              {humanizeIssues(event.rejectionReason).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <Section title="Post identity">
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Post kind">
              <Segmented options={EVENT_TYPES} value={f.eventType} onChange={(v) => setF({ ...f, eventType: v })} />
            </Field>
            <Field label="Source">
              <input className="input" value={sourceName} disabled />
            </Field>
          </div>
          <Field label={`Title (${f.title.length}/60)`} required missing={m("title")}>
            <input className="input" value={f.title} onChange={set("title")} maxLength={60} />
          </Field>
          <Field label={`Short description (${f.description.length}/200)`} required missing={m("description")}>
            <textarea className="input" rows={2} value={f.description} onChange={set("description")} maxLength={200} />
          </Field>
          <Field label={`Long description (${f.extendedDescription.length}/1000 — optional)`}>
            <textarea className="input" rows={4} value={f.extendedDescription} onChange={set("extendedDescription")} maxLength={1000} />
          </Field>
          <Field label="Sponsors (the hosting organizations)" required missing={m("sponsors")}>
            <div className="grid" style={{ gap: 6 }}>
              {sponsors.map((s, i) => (
                <div className="row" key={i} style={{ gap: 6 }}>
                  <input
                    className="input"
                    value={s}
                    placeholder="Organization name"
                    onChange={(e) => setSponsors(sponsors.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <button type="button" className="btn" onClick={() => setSponsors(sponsors.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className="btn" style={{ justifySelf: "start" }} onClick={() => setSponsors([...sponsors, ""])}>
                + Add sponsor
              </button>
            </div>
          </Field>
        </Section>

        <Section title="Schedule" hint={`Times are Oberlin time (${TZ}).`}>
          <Field label="Sessions" required missing={m("sessions")}>
            <div className="grid" style={{ gap: 6 }}>
              {sessions.map((s, i) => (
                <div className="row" key={i} style={{ gap: 6, flexWrap: "wrap" }}>
                  <input
                    className="input"
                    type="datetime-local"
                    style={{ maxWidth: 210 }}
                    value={toLocalInput(s.startTime)}
                    onChange={(e) =>
                      setSessions(sessions.map((x, j) => (j === i ? { ...x, startTime: fromLocalInput(e.target.value) } : x)))
                    }
                  />
                  <span className="muted" style={{ alignSelf: "center" }}>to</span>
                  <input
                    className="input"
                    type="datetime-local"
                    style={{ maxWidth: 210 }}
                    value={toLocalInput(s.endTime)}
                    onChange={(e) =>
                      setSessions(sessions.map((x, j) => (j === i ? { ...x, endTime: fromLocalInput(e.target.value) } : x)))
                    }
                  />
                  <button type="button" className="btn" onClick={() => setSessions(sessions.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn"
                style={{ justifySelf: "start" }}
                onClick={() => setSessions([...sessions, { startTime: 0, endTime: 0 }])}
              >
                + Add session
              </button>
            </div>
          </Field>
        </Section>

        <Section title="Location">
          <Field label="Location type">
            <Segmented options={LOCATION_TYPES} value={f.locationType} onChange={(v) => setF({ ...f, locationType: v })} />
          </Field>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {needsAddress && (
              <Field label="Street address" required missing={m("location")}>
                <input className="input" value={f.location} onChange={set("location")} />
              </Field>
            )}
            {needsUrl && (
              <Field label="Online event URL (optional)">
                <input className="input" value={f.urlLink} onChange={set("urlLink")} placeholder="https://…" />
              </Field>
            )}
            <Field label="Place name">
              <input className="input" value={f.placeName} onChange={set("placeName")} placeholder="e.g. Finney Chapel" />
            </Field>
            <Field label="Room or space">
              <input className="input" value={f.roomNum} onChange={set("roomNum")} />
            </Field>
          </div>
        </Section>

        <Section title="Categories and distribution">
          <Field label="CommunityHub categories (at least one)" required missing={m("cats")}>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {POST_TYPE_IDS.map((id) => {
                const on = cats.includes(id);
                return (
                  <button
                    type="button"
                    key={id}
                    className={`badge ${on ? "good" : "neutral"}`}
                    style={{ border: "none", cursor: "pointer" }}
                    onClick={() => setCats(on ? cats.filter((x) => x !== id) : [...cats, id])}
                  >
                    {POST_TYPES[id]}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Screen distribution">
              <Segmented options={DISPLAY_TYPES} value={f.displayType} onChange={(v) => setF({ ...f, displayType: v })} />
            </Field>
            <Field label="Geographic scope (internal, not sent to CommunityHub)">
              <Segmented options={GEO_SCOPES} value={f.geoScope} onChange={(v) => setF({ ...f, geoScope: v })} />
            </Field>
          </div>
          {f.displayType === "ss" && (
            <Field label="Specific screen IDs (comma separated)" required missing={m("screens")}>
              <input className="input" value={screenIds} onChange={(e) => setScreenIds(e.target.value)} placeholder="e.g. 12, 15" />
            </Field>
          )}
        </Section>

        <Section title="Contact and media">
          <Field label="Event image" required missing={m("imageCdnUrl")}>
            <input className="input" value={f.imageCdnUrl} onChange={set("imageCdnUrl")} placeholder="https://…/photo.jpg" />
            {(f.imageCdnUrl.trim() || event.hasImageData) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={f.imageCdnUrl.trim() || `/api/events/${event.id}/image`}
                alt="Event"
                style={{ marginTop: 8, maxHeight: 220, maxWidth: "100%", borderRadius: 8, border: "1px solid var(--line)", objectFit: "cover" }}
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
              />
            ) : (
              <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                Every event needs an image. Paste a direct image URL if the agent did not find one.
              </div>
            )}
          </Field>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Contact email" required missing={m("contactEmail")}>
              <input className="input" type="email" value={f.contactEmail} onChange={set("contactEmail")} />
            </Field>
            <Field label="Phone" required missing={m("phone")}>
              <input className="input" value={f.phone} onChange={set("phone")} />
            </Field>
            <Field label="Website" required missing={m("website")}>
              <input className="input" value={f.website} onChange={set("website")} />
            </Field>
            <Field label="Registration link (optional)">
              <input className="input" value={f.registrationUrl} onChange={set("registrationUrl")} />
            </Field>
          </div>
        </Section>

        <Section title="Action buttons" hint="Extra links shown on the post, e.g. Buy tickets.">
          <div className="grid" style={{ gap: 6 }}>
            {buttons.map((b, i) => (
              <div className="row" key={i} style={{ gap: 6, flexWrap: "wrap" }}>
                <input
                  className="input"
                  style={{ maxWidth: 200 }}
                  placeholder="Button label"
                  value={b.title}
                  onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                />
                <input
                  className="input"
                  placeholder="https://…"
                  value={b.link}
                  onChange={(e) => setButtons(buttons.map((x, j) => (j === i ? { ...x, link: e.target.value } : x)))}
                />
                <button type="button" className="btn" onClick={() => setButtons(buttons.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn"
              style={{ justifySelf: "start" }}
              onClick={() => setButtons([...buttons, { title: "", link: "" }])}
            >
              + Add button
            </button>
          </div>
        </Section>

        <Section title="Source attribution">
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Calendar source name">
              <input className="input" value={f.calendarSourceName} onChange={set("calendarSourceName")} />
            </Field>
            <Field label="Calendar source URL (the original page for this event)">
              <input className="input" value={f.calendarSourceUrl} onChange={set("calendarSourceUrl")} />
              {f.calendarSourceUrl.trim() && (
                <a
                  href={f.calendarSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-block", marginTop: 6, fontSize: 13, color: "var(--accent)" }}
                >
                  Open the original to check or fix it →
                </a>
              )}
            </Field>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="Publishing identity (sent as the payload email, set by the app)">
              <input className="input" value={publishEmail} disabled />
            </Field>
            <Field label="Reviewer record link (sent with the post, managed by this app)">
              <input className="input" value={event.ingestedPostUrl ?? ""} disabled />
            </Field>
          </div>
        </Section>

        {msg && <div className="badge">{msg}</div>}

        {rejecting ? (
          <div className="card">
            <Field label="Why is this wrong? (this is what the agent learns from)">
              <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                {REJECT_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note (optional, but it makes the next run better)">
              <textarea
                className="input"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. the date is the registration deadline, not the event date"
              />
            </Field>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => setRejecting(false)} disabled={!!busy}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: "var(--bad-bg)", color: "var(--bad)", borderColor: "transparent" }}
                onClick={reject}
                disabled={!!busy}
              >
                {busy === "reject" ? "Rejecting…" : "Confirm reject"}
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button className="btn primary" onClick={approve} disabled={!!busy} title={ready ? "" : "Fill required fields first"}>
              {busy === "approve" ? "Approving…" : "Approve"}
            </button>
            <button className="btn" onClick={save} disabled={!!busy}>
              {busy === "save" ? "Saving…" : "Save changes"}
            </button>
            <button className="btn" onClick={() => setRejecting(true)} disabled={!!busy}>
              Reject
            </button>
          </div>
        )}
      </div>

      {/* RIGHT: readiness + payload preview */}
      <div className="grid" style={{ gap: 16, position: "sticky", top: 16 }}>
        <div className="card">
          {(f.imageCdnUrl.trim() || event.hasImageData) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={f.imageCdnUrl.trim() || `/api/events/${event.id}/image`}
              alt="Event"
              style={{ width: "100%", maxHeight: 150, objectFit: "cover", borderRadius: 8, marginBottom: 10 }}
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
            />
          )}
          <div className="spread">
            <div className="label" style={{ margin: 0 }}>
              Readiness
            </div>
            <span className={`badge ${ready ? "good" : "warn"}`}>{ready ? "Ready" : `${missingKeys.length} to fix`}</span>
          </div>
          <div className="grid" style={{ gap: 4, marginTop: 8 }}>
            {READINESS.map((r) => {
              const ok = !missing[r.key as keyof typeof missing];
              return (
                <div key={r.key} className="row" style={{ gap: 6, fontSize: 13 }}>
                  <span style={{ color: ok ? "var(--good)" : "var(--muted)" }}>{ok ? "✓" : "○"}</span>
                  <span style={{ color: ok ? "var(--ink)" : "var(--muted)" }}>{r.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {event.fieldNotes && Object.keys(event.fieldNotes).length > 0 && (
          <div className="card">
            <div className="label">Agent notes</div>
            <div className="grid" style={{ gap: 4, fontSize: 12 }}>
              {Object.entries(event.fieldNotes).map(([k, v]) => (
                <div key={k}>
                  <b>{k}:</b> {v}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <button className="btn" style={{ width: "100%" }} onClick={() => setShowPayload(!showPayload)}>
            {showPayload ? "Hide" : "Show"} outgoing payload
          </button>
          {showPayload && (
            <pre
              style={{
                marginTop: 10,
                fontSize: 11,
                overflowX: "auto",
                background: "var(--accent-soft)",
                padding: 10,
                borderRadius: 8,
                maxHeight: 360,
              }}
            >
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

const LABELS: Record<string, string> = {
  title: "Title",
  description: "Short description",
  sessions: "Date/time",
  location: "Street address",
  website: "Website",
  imageCdnUrl: "Image",
  contactEmail: "Contact email",
  phone: "Phone",
  sponsors: "Sponsors",
  cats: "Categories",
  screens: "Screen IDs",
};

const READINESS = [
  { key: "title", label: "Title" },
  { key: "description", label: "Short description" },
  { key: "sessions", label: "At least one date" },
  { key: "location", label: "Address (if in person)" },
  { key: "cats", label: "A category" },
  { key: "sponsors", label: "A sponsor" },
  { key: "imageCdnUrl", label: "An image" },
  { key: "website", label: "Website" },
  { key: "contactEmail", label: "Contact email" },
  { key: "phone", label: "Phone" },
  { key: "screens", label: "Screen IDs (if specific)" },
];
