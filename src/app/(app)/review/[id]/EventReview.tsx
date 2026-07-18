"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  EVENT_TYPES,
  LOCATION_TYPES,
  POST_TYPES,
  POST_TYPE_IDS,
  REJECT_REASONS,
} from "@/lib/taxonomy";

type EventRow = {
  id: number;
  status: string;
  eventType: string | null;
  title: string | null;
  description: string | null;
  extendedDescription: string | null;
  sessions: { startTime: number; endTime: number }[] | null;
  locationType: string | null;
  location: string | null;
  urlLink: string | null;
  postTypeIds: number[] | null;
  sponsors: string[] | null;
  website: string | null;
  registrationUrl: string | null;
  contactEmail: string | null;
  phone: string | null;
  rejectionReason: string | null;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

export function EventReview({ event, sourceName }: { event: EventRow; sourceName: string }) {
  const router = useRouter();
  const [f, setF] = useState({
    eventType: event.eventType ?? "ot",
    title: event.title ?? "",
    description: event.description ?? "",
    extendedDescription: event.extendedDescription ?? "",
    locationType: event.locationType ?? "ne",
    location: event.location ?? "",
    urlLink: event.urlLink ?? "",
    website: event.website ?? "",
    registrationUrl: event.registrationUrl ?? "",
    contactEmail: event.contactEmail ?? "",
    phone: event.phone ?? "",
    sponsors: (event.sponsors ?? []).join(", "),
  });
  const [cats, setCats] = useState<number[]>(event.postTypeIds ?? []);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<string>(REJECT_REASONS[0].code);
  const [note, setNote] = useState("");

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  function payload() {
    return {
      ...f,
      sponsors: f.sponsors.split(",").map((x) => x.trim()).filter(Boolean),
      postTypeIds: cats,
    };
  }

  async function save() {
    setBusy("save");
    setMsg(null);
    const res = await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload()),
    });
    const d = await res.json();
    setBusy(null);
    setMsg(res.ok ? (d.changed ? `Saved ${d.changed} change(s). The agent learns from these.` : "No changes.") : d.error);
    if (res.ok) router.refresh();
  }

  async function approve() {
    setBusy("approve");
    // Persist any edits first so the approved version is the corrected one.
    await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload()),
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

  const when = (event.sessions ?? []).map((s) =>
    new Date(s.startTime * 1000).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  );

  return (
    <div className="grid" style={{ gap: 16 }}>
      {event.rejectionReason && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <div className="label">Flagged by validation</div>
          <div>{event.rejectionReason}</div>
        </div>
      )}

      <div className="card">
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Row label="Type">
            <select className="input" value={f.eventType} onChange={set("eventType")}>
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Source">
            <input className="input" value={sourceName} disabled />
          </Row>
        </div>

        <Row label={`Title (${f.title.length}/60)`}>
          <input className="input" value={f.title} onChange={set("title")} maxLength={60} />
        </Row>

        <Row label={`Short description (${f.description.length}/200)`}>
          <textarea className="input" rows={2} value={f.description} onChange={set("description")} />
        </Row>

        <Row label="Long description (no links or addresses)">
          <textarea
            className="input"
            rows={4}
            value={f.extendedDescription}
            onChange={set("extendedDescription")}
          />
        </Row>

        <Row label="When (from the source)">
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {when.length ? (
              when.map((w) => (
                <span className="badge neutral" key={w}>
                  {w}
                </span>
              ))
            ) : (
              <span className="muted">No dates</span>
            )}
          </div>
        </Row>
      </div>

      <div className="card">
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Row label="Location type">
            <select className="input" value={f.locationType} onChange={set("locationType")}>
              {LOCATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Address / venue">
            <input className="input" value={f.location} onChange={set("location")} />
          </Row>
          <Row label="Online link">
            <input className="input" value={f.urlLink} onChange={set("urlLink")} />
          </Row>
          <Row label="Registration link">
            <input className="input" value={f.registrationUrl} onChange={set("registrationUrl")} />
          </Row>
          <Row label="Website">
            <input className="input" value={f.website} onChange={set("website")} />
          </Row>
          <Row label="Sponsors (comma separated)">
            <input className="input" value={f.sponsors} onChange={set("sponsors")} />
          </Row>
          <Row label="Contact email">
            <input className="input" value={f.contactEmail} onChange={set("contactEmail")} />
          </Row>
          <Row label="Phone">
            <input className="input" value={f.phone} onChange={set("phone")} />
          </Row>
        </div>

        <Row label="Categories">
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
        </Row>
      </div>

      {msg && <div className="badge">{msg}</div>}

      {rejecting ? (
        <div className="card">
          <Row label="Why is this wrong? (this is what the agent learns from)">
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REJECT_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Note (optional, but it makes the next run better)">
            <textarea
              className="input"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. the date is the registration deadline, not the event date"
            />
          </Row>
          <div className="row">
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
          <button className="btn primary" onClick={approve} disabled={!!busy}>
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
  );
}
