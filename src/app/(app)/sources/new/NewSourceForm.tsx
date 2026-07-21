"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { LOOKAHEAD_OPTIONS, SCHEDULE_OPTIONS } from "@/lib/schedule";

type Community = { id: number; name: string };

/** The research prompt the admin copies into ChatGPT or Claude. */
function researchPrompt(name: string, urls: string[]) {
  const links = urls.length ? urls.join("\n") : "(link)";
  return `Go to this site for ${name}:
${links}

Explore it and find every way its events can be fetched: calendar pages, JSON APIs, iCal or RSS feeds, embedded calendar widgets, and individual event pages. Then describe, in detail, the BEST way to extract ALL upcoming events, as numbered step-by-step instructions another AI agent can follow exactly:

1. The exact URLs to fetch, in order, and how to find every event from them (including pagination or "load more").
2. Where each field lives: title, full description, exact start and end date and time with timezone, venue name and street address, the event image or flyer URL, registration or ticket link, and price.
3. Anything easy to get wrong on this site: recurring events, multi-day events, cancelled or sold-out items, date formats.
4. If the site blocks normal fetching (403 or a bot challenge), say exactly how to get past it, for example fetching over HTTP/1.1 with a browser user agent.
5. If individual events do not list their own contact email and phone, find the organization's general contact email address and phone number and state them so they can be used as the default contact for every event.

Verify your instructions actually work by checking a few real events before you answer.`;
}

export function NewSourceForm({
  communities,
  isPlatformAdmin,
}: {
  communities: Community[];
  isPlatformAdmin: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [urls, setUrls] = useState("");
  const [sourceType, setSourceType] = useState<"web" | "email">("web");
  const [special, setSpecial] = useState("");
  const [schedule, setSchedule] = useState("daily");
  const [lookaheadDays, setLookaheadDays] = useState(14);
  const [communityId, setCommunityId] = useState<number>(communities[0]?.id ?? 0);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const urlList = useMemo(
    () => urls.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean),
    [urls],
  );
  const prompt = useMemo(() => researchPrompt(name || "this organization", urlList), [name, urlList]);

  // Steps: 0 name, 1 links (web only), 2 schedule, 3 research + save.
  const steps = sourceType === "web" ? ["Name", "Link", "Schedule", "Instructions"] : ["Name", "Schedule", "Instructions"];
  const stepKey = steps[step];

  function canNext() {
    if (stepKey === "Name") return name.trim().length > 1;
    if (stepKey === "Link") return urlList.length > 0;
    return true;
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the textarea below is selectable as a fallback */
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          urls: urlList,
          sourceType,
          specialInstructions: special,
          schedule,
          lookaheadDays,
          communityId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create the source.");
        setBusy(false);
        return;
      }
      router.push(`/sources/${data.id}`);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="card grid" style={{ gap: 16 }}>
      {/* Step indicator */}
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {steps.map((label, i) => (
          <span key={label} className={`badge ${i === step ? "good" : i < step ? "neutral" : ""}`}
            style={{ opacity: i > step ? 0.45 : 1 }}>
            {i + 1}. {label}
          </span>
        ))}
      </div>

      {stepKey === "Name" && (
        <div className="grid" style={{ gap: 12 }}>
          {isPlatformAdmin && communities.length > 1 && (
            <div>
              <label className="label">Community</label>
              <select className="input" value={communityId} onChange={(e) => setCommunityId(Number(e.target.value))}>
                {communities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">What is this source called?</label>
            <input
              className="input"
              placeholder="e.g. Oberlin Public Library"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={sourceType} onChange={(e) => { setSourceType(e.target.value as "web" | "email"); setStep(0); }}>
              <option value="web">Website / calendar link</option>
              <option value="email">Email inbox</option>
            </select>
          </div>
        </div>
      )}

      {stepKey === "Link" && (
        <div>
          <label className="label">Where do their events live?</label>
          <textarea
            className="input"
            rows={3}
            placeholder={"https://example.org/events\nhttps://example.org/calendar"}
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            autoCapitalize="none"
            autoFocus
          />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            One per line. Add every page this organization publishes events on. The first is the main one.
          </div>
        </div>
      )}

      {stepKey === "Schedule" && (
        <div className="grid" style={{ gap: 14 }}>
          <div>
            <label className="label">How often should the agent check {name || "this source"}?</label>
            <select className="input" value={schedule} onChange={(e) => setSchedule(e.target.value)} autoFocus>
              {SCHEDULE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">How far ahead should it look for events?</label>
            <select
              className="input"
              value={lookaheadDays}
              onChange={(e) => setLookaheadDays(Number(e.target.value))}
            >
              {LOOKAHEAD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Two weeks keeps big calendars manageable. A small organization with only a few
              events a year can look further out. Sources with about ten or fewer upcoming items
              always take all of them. Both settings can be changed later on the source page.
            </div>
          </div>
        </div>
      )}

      {stepKey === "Instructions" && (
        <div className="grid" style={{ gap: 14 }}>
          <div>
            <div className="label">Step 1 · Copy this prompt into ChatGPT or Claude</div>
            <p className="muted" style={{ marginTop: 2, fontSize: 13 }}>
              Let it research the site and write the extraction instructions for you.
            </p>
            <textarea className="input" rows={10} readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} style={{ fontSize: 12 }} />
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn" type="button" onClick={copyPrompt}>
                {copied ? "Copied" : "Copy prompt"}
              </button>
            </div>
          </div>

          <div>
            <div className="label">Step 2 · Paste its answer here</div>
            <p className="muted" style={{ marginTop: 2, fontSize: 13 }}>
              Paste the full response, then add anything else you know about this source
              (rules for what to keep or skip, default sponsor, sections to ignore).
            </p>
            <textarea
              className="input"
              rows={10}
              placeholder="Paste the research answer here, then add your own notes below it."
              value={special}
              onChange={(e) => setSpecial(e.target.value)}
            />
          </div>
        </div>
      )}

      {error && <div className="badge bad">{error}</div>}

      <div className="row" style={{ gap: 8 }}>
        {step > 0 && (
          <button className="btn" type="button" disabled={busy} onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {stepKey !== "Instructions" ? (
          <button className="btn primary" type="button" disabled={!canNext()} onClick={() => setStep(step + 1)}>
            Next
          </button>
        ) : (
          <button
            className="btn primary"
            type="button"
            disabled={busy || (sourceType === "web" && special.trim().length < 40)}
            title={sourceType === "web" && special.trim().length < 40 ? "Paste the research answer first." : undefined}
            onClick={submit}
          >
            {busy ? "Saving…" : "Save source"}
          </button>
        )}
        <button className="btn" type="button" onClick={() => router.push("/sources")} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
