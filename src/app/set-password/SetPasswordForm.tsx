"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, ButtonLink, Card } from "@/components/ui";

export function SetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) { setError("Make both passwords match, then try again."); return; }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/set-password", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }),
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error || "Choose a different password, then try again."); return; }
      router.push("/dashboard");
    } catch {
      setError("Check your connection, then try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <Card className="auth-card form-stack">
        <div><h1>This Link Is Invalid</h1><p className="auth-card__intro">Ask an administrator for a new invitation, or request another setup link from sign in.</p></div>
        <ButtonLink href="/login" icon="arrow-left">Back to Sign In</ButtonLink>
      </Card>
    );
  }

  return (
    <Card className="auth-card">
      <form onSubmit={submit} className="form-stack">
        <div><h1>Choose a Password</h1><p className="auth-card__intro">Use at least 8 characters, including a letter and a number.</p></div>
        <div className="field-group">
          <label className="label" htmlFor="new-password">New Password</label>
          <input id="new-password" name="newPassword" className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="Create a secure password…" minLength={8} required />
        </div>
        <div className="field-group">
          <label className="label" htmlFor="confirm-password">Confirm Password</label>
          <input id="confirm-password" name="confirmPassword" className="input" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" placeholder="Enter it again…" minLength={8} required />
        </div>
        {error && <Alert tone="danger" title="Couldn’t Save Password">{error}</Alert>}
        <Button variant="primary" type="submit" disabled={busy || !password || !confirm}>{busy ? "Saving Password…" : "Set Password & Sign In"}</Button>
      </form>
    </Card>
  );
}
