"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/set-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(d.error || "Could not set your password.");
      return;
    }
    router.push("/dashboard");
  }

  if (!token) {
    return (
      <div className="card">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>This link is not valid</div>
        <p className="muted" style={{ marginTop: 0 }}>
          Ask an admin to invite you again, or use the forgot-password option on the sign-in page.
        </p>
        <a className="btn" href="/login">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Choose a password</div>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        At least 8 characters, with a letter and a number.
      </p>
      <div style={{ marginTop: 12 }}>
        <label className="label">New password</label>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="label">Confirm password</label>
        <input
          className="input"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>
      {error && (
        <div className="badge bad" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      <button
        className="btn primary"
        type="submit"
        disabled={busy || !password}
        style={{ marginTop: 16, width: "100%", justifyContent: "center" }}
      >
        {busy ? "Saving…" : "Set password and sign in"}
      </button>
    </form>
  );
}
