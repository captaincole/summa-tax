"use client";

// Single-user login: one password, one owner. If setup hasn't run yet the
// server layout for this route redirects to /setup before this renders.

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setError(res.status === 401 ? "Wrong password." : `Login failed (${res.status}).`);
      setSubmitting(false);
      return;
    }
    // refresh() re-runs Server Components with the new session cookie; push()
    // navigates to the protected home page.
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
          <h1 className="font-serif text-4xl text-ink-primary mb-3">Sign in</h1>
          <p className="text-ink-secondary text-sm">
            Enter your password to unlock this instance.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            autoComplete="current-password"
            className="input-base"
          />
          {error && <div className="text-red-400 text-sm px-1">{error}</div>}
          <button
            type="submit"
            disabled={submitting || !password}
            className="btn-primary"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-10 text-center text-ink-faint text-xs">
          Self-hosted · Your data stays on this machine
        </div>
      </div>
    </div>
  );
}
