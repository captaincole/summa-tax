import type { SupabaseClient } from "@supabase/supabase-js";

// Filings — the ownership root. Every domain row (tax_facts, ai_decisions,
// etc.) carries a filing_id; access is gated by filing_members membership.
//
// For the current single-owner-per-user flow there's one active filing per
// (user, tax_year). Resolution goes through RLS — the user-scoped Supabase
// client only returns filings the caller has membership in, so no explicit
// auth.uid() filter is needed.

export type FilingMemberRole = "owner" | "cpa_reviewer";

export interface FilingRow {
  id: string;
  taxYear: number;
  status: string;
  createdAt: string;
}

interface FilingDbRow {
  id: string;
  tax_year: number;
  status: string;
  created_at: string;
}

function rowToFiling(r: FilingDbRow): FilingRow {
  return {
    id: r.id,
    taxYear: r.tax_year,
    status: r.status,
    createdAt: r.created_at,
  };
}

// Resolve the caller's active owner filing for a given tax year. Throws if
// there isn't exactly one — that's a misconfiguration we want to surface
// loudly rather than silently picking a filing.
//
// Two failure cases worth knowing about:
//   - No filing exists yet: run supabase/scripts/seed_filings.sql against
//     the DB after the migration. The script is manual on purpose; we'll
//     add an in-app "Start your <year> return" affordance later.
//   - Multiple owner filings for the same year: shouldn't happen given the
//     seed script's NOT EXISTS guard, but error loudly if it does.
export async function resolveOwnerFilingForYear(
  supabase: SupabaseClient,
  taxYear: number,
): Promise<FilingRow> {
  const { data, error } = await supabase
    .from("filings")
    .select("id, tax_year, status, created_at, filing_members!inner(role, revoked_at)")
    .eq("tax_year", taxYear)
    .eq("filing_members.role", "owner")
    .is("filing_members.revoked_at", null);
  if (error) {
    throw new Error(`resolveOwnerFilingForYear failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<FilingDbRow & { filing_members: unknown }>;
  if (rows.length === 0) {
    throw new Error(
      `No owner filing found for tax_year=${taxYear}. Run supabase/scripts/seed_filings.sql.`,
    );
  }
  if (rows.length > 1) {
    throw new Error(
      `Multiple owner filings for tax_year=${taxYear} (${rows.length}); ambiguous.`,
    );
  }
  return rowToFiling(rows[0]);
}
