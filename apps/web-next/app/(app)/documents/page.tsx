// Stub. Real page lands in Phase 4 with Server Component drafts/uploads
// reads + the /documents/[id] Route Handler for cookie-authenticated PDF
// downloads.
export default function DocumentsPage() {
  return (
    <div className="flex-1 min-w-0 min-h-0 overflow-y-auto px-4 lg:px-10 py-8 lg:py-12">
      <div className="max-w-3xl mx-auto">
        <div className="text-ink-muted text-[10px] uppercase tracking-[0.24em]">
          Tax Documents
        </div>
        <h1 className="mt-2 font-serif text-3xl text-ink-primary">
          Your filing cabinet
        </h1>
        <p className="mt-3 text-ink-secondary text-sm">
          Ports in Phase 4.
        </p>
      </div>
    </div>
  );
}
