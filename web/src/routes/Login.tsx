import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchState, UnauthorizedError } from "@/lib/api";
import { setPasscode, getPasscode } from "@/lib/auth";

export function Login() {
  const navigate = useNavigate();
  const [passcode, setPasscodeInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already-signed-in tab → skip straight to chat.
  useEffect(() => {
    if (getPasscode()) navigate("/", { replace: true });
  }, [navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!passcode || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Validate the passcode by hitting an authed endpoint with it.
      // On 200 we know SimpleAuth accepted the token.
      await fetchState(passcode);
      setPasscode(passcode);
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setError("Invalid passcode.");
      } else {
        setError("Couldn't reach the server. Is mastra running?");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg-base bg-grid relative flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-hero-glow pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm animate-fade-in">
        <div className="mb-10 text-center">
          <div className="text-ink-muted text-[11px] uppercase tracking-[0.28em] mb-4">
            Wheel of Time
          </div>
          <h1 className="font-serif text-4xl text-ink-primary mb-3">
            Demo access
          </h1>
          <p className="text-ink-secondary text-sm">
            Enter the passcode to start a session.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscodeInput(e.target.value)}
            placeholder="Passcode"
            autoFocus
            autoComplete="off"
            className="input-base"
          />
          {error && (
            <div className="text-red-400 text-sm px-1">{error}</div>
          )}
          <button
            type="submit"
            disabled={submitting || !passcode}
            className="btn-primary"
          >
            {submitting ? "Checking…" : "Continue"}
          </button>
        </form>

        <div className="mt-10 text-center text-ink-faint text-xs">
          For demo only · No data is shared between sessions
        </div>
      </div>
    </div>
  );
}
