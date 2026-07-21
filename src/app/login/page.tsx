"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNeedsPassword(false);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (response.ok) {
        router.push("/dashboard");
        return;
      }
      if (data.needsPassword) setNeedsPassword(true);
      setError(data.error || "Check your email and password, then try again.");
    } catch {
      setError("Check your connection, then try signing in again.");
    } finally {
      setBusy(false);
    }
  }

  async function requestLink() {
    setBusy(true);
    setError(null);
    setDevLink(null);
    try {
      const response = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Check the email address, then request a new link.");
        return;
      }
      setSent(true);
      if (data.devLink) setDevLink(data.devLink);
    } catch {
      setError("Check your connection, then request the link again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-panel">
        <div className="auth-brand">
          <Image src="/brand/communityhub-wordmark.png" alt="CommunityHub" width={1662} height={255} priority />
          <div className="auth-brand__product">AI Calendar</div>
          <p>Turn community information into events people can act on.</p>
        </div>

        <Card className="auth-card">
          {sent ? (
            <div className="form-stack">
              <div><h1>Check Your Email</h1><p className="auth-card__intro">A secure setup link is on its way to <strong>{email}</strong>. It remains valid for 24 hours.</p></div>
              <Alert tone="success">You can close this window after the email arrives.</Alert>
              {devLink && (
                <Alert title="Development Link">
                  Email delivery is not configured. <a className="table-link" href={devLink}>Open the secure setup link</a>.
                </Alert>
              )}
              <Button type="button" onClick={() => setSent(false)}>Back to Sign In</Button>
            </div>
          ) : (
            <form onSubmit={signIn} className="form-stack">
              <div><h1>Welcome Back</h1><p className="auth-card__intro">Sign in to manage your community workspace.</p></div>
              <div className="field-group">
                <label className="label" htmlFor="email">Work Email</label>
                <input
                  id="email" name="email" className="input" type="email" inputMode="email"
                  autoCapitalize="none" autoCorrect="off" autoComplete="username" spellCheck={false}
                  placeholder="name@organization.org…" value={email} onChange={(event) => setEmail(event.target.value)} required
                />
              </div>
              <div className="field-group">
                <label className="label" htmlFor="password">Password</label>
                <input
                  id="password" name="password" className="input" type="password" autoComplete="current-password"
                  placeholder="Enter your password…" value={password} onChange={(event) => setPassword(event.target.value)} required
                />
              </div>
              {error && <Alert tone="danger" title="Couldn’t Sign In">{error}</Alert>}
              <div className="auth-actions">
                <Button variant="primary" type="submit" disabled={busy || !email || !password}>{busy ? "Signing In…" : "Sign In"}</Button>
                <Button type="button" onClick={requestLink} disabled={busy || !email}>{needsPassword ? "Set Your Password" : "First Time Here or Forgot Password?"}</Button>
              </div>
            </form>
          )}
        </Card>
        <p className="auth-footer">Access is managed by your CommunityHub administrator.</p>
      </div>
    </main>
  );
}
