"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setError(null);
    setDevLink(null);
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setState("idle");
        return;
      }
      setState("sent");
      if (data.devLink) setDevLink(data.devLink);
    } catch {
      setError("Network error. Try again.");
      setState("idle");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/communityhub-wordmark.png"
            alt="CommunityHub"
            style={{ width: 210, height: "auto", display: "block", margin: "0 auto" }}
          />
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
              marginTop: 8,
            }}
          >
            AI Calendar
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            Sign in to your community workspace.
          </div>
        </div>

        <div className="card">
          {state === "sent" ? (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Check your email</div>
              <p className="muted" style={{ marginTop: 0 }}>
                If an account exists for <b>{email}</b>, a sign-in link is on its way. It expires in
                15 minutes.
              </p>
              {devLink && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 9,
                    background: "var(--accent-soft)",
                  }}
                >
                  <div className="label" style={{ marginBottom: 4 }}>
                    Dev mode (no Resend key set)
                  </div>
                  <a href={devLink} style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                    {devLink}
                  </a>
                </div>
              )}
              <button
                className="btn"
                style={{ marginTop: 14 }}
                onClick={() => {
                  setState("idle");
                  setDevLink(null);
                }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              <label className="label" htmlFor="email">
                Work email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="you@example.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              {error && (
                <div className="badge bad" style={{ marginTop: 10 }}>
                  {error}
                </div>
              )}
              <button
                className="btn primary"
                type="submit"
                disabled={state === "sending" || !email}
                style={{ marginTop: 14, width: "100%", justifyContent: "center" }}
              >
                {state === "sending" ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
          )}
        </div>
        <p className="muted" style={{ textAlign: "center", fontSize: 12, marginTop: 16 }}>
          Access is managed by your admin. No password needed.
        </p>
      </div>
    </div>
  );
}
