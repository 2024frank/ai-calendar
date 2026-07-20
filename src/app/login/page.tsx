"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNeedsPassword(false);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const d = await res.json();
      if (res.ok) {
        router.push("/dashboard");
        return;
      }
      if (d.needsPassword) setNeedsPassword(true);
      setError(d.error || "Could not sign in.");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function requestLink() {
    setBusy(true);
    setError(null);
    setDevLink(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await res.json();
      if (!res.ok) {
        // e.g. the email is not in the system -> not authorized.
        setError(d.error || "Could not send the reset email.");
        return;
      }
      setSent(true);
      if (d.devLink) setDevLink(d.devLink);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
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
          {sent ? (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Check your email</div>
              <p className="muted" style={{ marginTop: 0 }}>
                If an account exists for <b>{email}</b>, we sent a link to set your password. It is
                valid for 24 hours.
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
                    Email delivery is not configured yet, so use this link
                  </div>
                  <a href={devLink} style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                    {devLink}
                  </a>
                </div>
              )}
              <button className="btn" style={{ marginTop: 14 }} onClick={() => setSent(false)}>
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={signIn}>
              <label className="label" htmlFor="email">
                Work email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                placeholder="you@example.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <label className="label" htmlFor="password" style={{ marginTop: 12 }}>
                Password
              </label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />

              {error && (
                <div className="badge bad" style={{ marginTop: 12 }}>
                  {error}
                </div>
              )}

              <button
                className="btn primary"
                type="submit"
                disabled={busy || !email || !password}
                style={{ marginTop: 14, width: "100%", justifyContent: "center" }}
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>

              <button
                type="button"
                className="btn"
                onClick={requestLink}
                disabled={busy || !email}
                style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
              >
                {needsPassword ? "Set your password" : "First time here, or forgot password"}
              </button>
            </form>
          )}
        </div>
        <p className="muted" style={{ textAlign: "center", fontSize: 12, marginTop: 16 }}>
          Access is managed by your admin.
        </p>
      </div>
    </div>
  );
}
