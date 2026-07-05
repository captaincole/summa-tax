"use client";

// First-run setup: create the instance owner. One-shot — the API 409s once
// an owner exists, and the server layout redirects to /login in that case.

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    displayName.trim() && email.trim() && password.length >= 8 && !submitting;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, email, password }),
    });
    if (!res.ok) {
      let message = `Setup failed (${res.status}).`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        /* keep default */
      }
      setError(message);
      setSubmitting(false);
      return;
    }
    router.refresh();
    router.push("/");
  }

  return (
    <div className="min-h-screen bg-bg-base bg-grid relative flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-hero-glow pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm animate-fade-in">
        <div className="mb-10 text-center">
          <div className="text-ink-muted text-[11px] uppercase tracking-[0.28em] mb-4">
            Summa
          </div>
          <h1 className="font-serif text-4xl text-ink-primary mb-3">Welcome</h1>
          <p className="text-ink-secondary text-sm">
            This instance is yours. Set a name, email, and password to get
            started — everything stays on this machine.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            autoFocus
            autoComplete="name"
            className="input-base"
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (used on your tax forms)"
            autoComplete="email"
            className="input-base"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (8+ characters)"
            autoComplete="new-password"
            className="input-base"
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            className="input-base"
          />
          {error && <div className="text-red-400 text-sm px-1">{error}</div>}
          <button type="submit" disabled={!canSubmit} className="btn-primary">
            {submitting ? "Setting up…" : "Create owner account"}
          </button>
        </form>
      </div>
    </div>
  );
}
