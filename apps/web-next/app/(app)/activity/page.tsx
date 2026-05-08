// Stub. Real page lands in Phase 5 — replaces /app/activity bearer fetch
// with a Server Component reading tax_facts + ai_decisions directly.
export default function ActivityPage() {
  return (
    <div className="flex-1 min-w-0 min-h-0 overflow-y-auto px-4 lg:px-10 py-8 lg:py-12">
      <div className="max-w-3xl mx-auto">
        <div className="text-ink-muted text-[10px] uppercase tracking-[0.24em]">
          Activity
        </div>
        <h1 className="mt-2 font-serif text-3xl text-ink-primary">
          Recent activity
        </h1>
        <p className="mt-3 text-ink-secondary text-sm">
          Ports in Phase 5.
        </p>
      </div>
    </div>
  );
}
