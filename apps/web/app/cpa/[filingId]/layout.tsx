import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatTaxpayerLabel, taxpayerNameForFiling } from "@/lib/cpa";

// Per-filing layout for the CPA review surface. Membership-gated; if the
// signed-in user doesn't have a non-revoked cpa_reviewer row on this
// filing, we 404 (not 403 — we don't want to confirm the filing exists
// to a non-reviewer).
//
// Layout shape: thin top bar (back to /cpa + taxpayer label + initials) +
// children. No tab nav yet — Forms is the only tab in this slice. Add a
// horizontal nav strip once a second tab (Activity, Documents) lands.

export default async function CpaFilingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ filingId: string }>;
}) {
  const { filingId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Membership check: pulls the filing only if the caller has a non-revoked
  // cpa_reviewer row. RLS makes this query empty for non-members anyway;
  // the explicit eq() makes the gate readable.
  const { data: filing, error } = await supabase
    .from("filings")
    .select(
      "id, tax_year, status, filing_members!inner(role, revoked_at, user_id)",
    )
    .eq("id", filingId)
    .eq("filing_members.user_id", user?.id ?? "")
    .eq("filing_members.role", "cpa_reviewer")
    .is("filing_members.revoked_at", null)
    .maybeSingle();
  if (error || !filing) notFound();

  const name = await taxpayerNameForFiling(supabase, filingId);
  const label = formatTaxpayerLabel(name, filingId);
  const initials = (user?.email?.slice(0, 2) ?? "JD").toUpperCase();

  return (
    <div className="min-h-screen w-full bg-bg-base text-ink-primary flex flex-col">
      <header className="shrink-0 h-14 border-b border-border-subtle bg-bg-base/95 backdrop-blur-sm flex items-center px-4 lg:px-6 gap-3">
        <Link
          href="/cpa"
          title="Back to CPA review home"
          className="shrink-0 text-ink-muted hover:text-ink-primary text-sm flex items-center gap-1.5 transition-colors"
        >
          <span className="text-base leading-none">←</span>
          <span>All filings</span>
        </Link>
        <div className="h-6 w-px bg-border-subtle shrink-0" />
        <div className="min-w-0 flex items-baseline gap-2.5">
          <span className="text-[15px] font-semibold tracking-tight text-ink-primary truncate">
            {label}
          </span>
          <span className="text-[11px] uppercase tracking-[0.18em] text-ink-muted shrink-0">
            Tax Year {(filing as { tax_year: number }).tax_year}
          </span>
        </div>
        <div className="flex-1" />
        <div className="w-8 h-8 rounded-full bg-accent/20 border border-accent/40 flex items-center justify-center text-xs font-medium text-accent">
          {initials}
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
