// CPA landing list. Server component; renders every filing the signed-in
// user has a non-revoked cpa_reviewer membership on, sorted newest-first.
//
// Identity facts (taxpayer first/last name) are fetched per-filing via
// taxpayerNameForFiling — RLS lets the reviewer read them, no service
// role needed. Done in parallel via Promise.all so the page renders in
// roughly the time of the slowest single lookup.
//
// Empty state when the user has zero reviewer memberships. Useful for two
// cases: a CPA before any taxpayer has invited them, and a taxpayer who
// accidentally hit /cpa.

import Link from "next/link";
import { getOwnerSession } from "@/lib/localAuth";
import {
  listReviewableFilings,
  taxpayerNameForFiling,
  type ReviewableFilingRow,
} from "@/lib/serverDb";
import { formatTaxpayerLabel } from "@/lib/cpa";

interface FilingCardData {
  filing: ReviewableFilingRow;
  label: string;
}

export default async function CpaHome() {
  const session = await getOwnerSession();
  const initials = (session?.email?.slice(0, 2) ?? "JD").toUpperCase();

  const filings = session ? await listReviewableFilings(session.userId) : [];
  const cards: FilingCardData[] = await Promise.all(
    filings.map(async (f) => ({
      filing: f,
      label: formatTaxpayerLabel(await taxpayerNameForFiling(f.id), f.id),
    })),
  );

  return (
    <div className="min-h-screen w-full bg-bg-base text-ink-primary flex flex-col">
      <CpaTopBar initials={initials} />
      <main className="flex-1 px-6 lg:px-10 py-10 lg:py-14">
        <div className="max-w-5xl mx-auto space-y-10">
          <header>
            <div className="text-[11px] uppercase tracking-[0.22em] text-ink-muted">
              CPA Review
            </div>
            <h1 className="font-serif text-4xl text-ink-primary mt-2">
              Returns to review
            </h1>
            <p className="text-ink-secondary text-[15px] mt-2.5">
              Read-only view of every taxpayer that's invited you to review their return.
            </p>
          </header>

          {cards.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {cards.map(({ filing, label }) => (
                <FilingCard key={filing.id} filing={filing} label={label} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function CpaTopBar({ initials }: { initials: string }) {
  return (
    <header className="shrink-0 h-14 border-b border-border-subtle bg-bg-base/95 backdrop-blur-sm flex items-center px-4 lg:px-6 gap-3">
      <Link
        href="/cpa"
        title="CPA review home"
        className="shrink-0 w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center hover:bg-accent/25 transition-colors"
      >
        <span className="font-serif text-accent text-sm leading-none">W</span>
      </Link>
      <div className="h-6 w-px bg-border-subtle shrink-0" />
      <span className="text-[15px] font-semibold tracking-tight text-ink-primary">
        CPA Review
      </span>
      <div className="flex-1" />
      <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-xs font-medium text-accent">
        {initials}
      </div>
    </header>
  );
}

function FilingCard({
  filing,
  label,
}: {
  filing: ReviewableFilingRow;
  label: string;
}) {
  return (
    <Link
      href={`/cpa/${filing.id}/forms`}
      className="card p-5 transition-all hover:border-border-strong flex flex-col gap-4 min-h-[160px]"
    >
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
          Tax Year {filing.taxYear}
        </div>
        <div className="text-[15px] font-semibold text-ink-primary mt-1 tracking-tight truncate">
          {label}
        </div>
      </div>
      <div className="mt-auto text-[12px] flex items-baseline justify-between">
        <StatusPill status={filing.status} />
        <span className="text-ink-secondary">Open →</span>
      </div>
    </Link>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: string }> = {
    draft: { label: "In progress", tone: "bg-accent/15 text-accent" },
    ready_for_review: {
      label: "Ready for review",
      tone: "bg-amber-400/10 text-amber-300",
    },
    filed: { label: "Filed", tone: "bg-emerald-400/10 text-emerald-400" },
  };
  const fallback = { label: status, tone: "bg-bg-elevated text-ink-muted" };
  const { label, tone } = map[status] ?? fallback;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ${tone}`}>
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="card px-8 py-12 text-center">
      <div className="font-serif text-2xl text-ink-primary">Nothing to review yet</div>
      <p className="text-ink-secondary text-sm mt-3 max-w-md mx-auto leading-relaxed">
        Once a taxpayer adds you as a reviewer on their return, it'll show up here. If you're expecting access, ask them to grant you a CPA-reviewer role on their filing.
      </p>
    </div>
  );
}
