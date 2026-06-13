"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password || submitting) return;
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
      setSubmitting(false);
      return;
    }
    // refresh() re-runs Server Components with the new session cookie; push()
    // navigates to the protected home page where the (app) layout will see
    // the user.
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
            Enter your email and password to start a session.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoFocus
            autoComplete="email"
            className="input-base"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="input-base"
          />
          {error && <div className="text-red-400 text-sm px-1">{error}</div>}
          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="btn-primary"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="mt-10 text-center text-ink-faint text-xs">
          For demo only · No data is shared between sessions
        </div>
      </div>
    </div>
  );
}
