export default function LoginPage() {
  return (
    <div className="min-h-screen bg-bg-base bg-grid relative flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-hero-glow pointer-events-none" />
      <div className="relative card px-8 py-10 w-full max-w-sm">
        <div className="text-ink-muted text-[10px] uppercase tracking-[0.24em] text-center">
          Wheel of Time
        </div>
        <h1 className="mt-2 font-serif text-2xl text-ink-primary text-center">
          Sign in
        </h1>
        <p className="mt-3 text-ink-secondary text-sm text-center">
          Login form ports in Phase 2.
        </p>
      </div>
    </div>
  );
}
