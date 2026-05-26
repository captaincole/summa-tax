import type { SupabaseClient } from "@supabase/supabase-js";

// Filing resolver for the web side. Mirrors apps/agent/src/mastra/db/filings.ts
// but built against the user-JWT-scoped supabase client (browser or server).
// RLS already gates the query to filings the caller has membership in, so we
// only need to filter by tax_year + role to disambiguate.

export interface FilingRow {
  id: string;
  taxYear: number;
  status: string;
}

export interface ReviewableFilingRow extends FilingRow {
  createdAt: string;
}

interface FilingDbRow {
  id: string;
  tax_year: number;
  status: string;
}

interface ReviewableFilingDbRow extends FilingDbRow {
  created_at: string;
}

export async function getOwnerFilingForYear(
  supabase: SupabaseClient,
  taxYear: number,
): Promise<FilingRow> {
  const { data, error } = await supabase
    .from("filings")
    .select(
      "id, tax_year, status, filing_members!inner(role, revoked_at)",
    )
    .eq("tax_year", taxYear)
    .eq("filing_members.role", "owner")
    .is("filing_members.revoked_at", null);
  if (error) {
    throw new Error(`getOwnerFilingForYear failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<FilingDbRow & { filing_members: unknown }>;
  if (rows.length === 0) {
    throw new Error(`No owner filing found for tax_year=${taxYear}.`);
  }
  if (rows.length > 1) {
    throw new Error(
      `Multiple owner filings for tax_year=${taxYear} (${rows.length}); ambiguous.`,
    );
  }
  const r = rows[0];
  return { id: r.id, taxYear: r.tax_year, status: r.status };
}

// List every filing the caller has a non-revoked cpa_reviewer membership
// on. Empty array (not throw) when the caller reviews nothing — the CPA
// landing page wants to render an empty state, not an error.
//
// Sorted newest-first by created_at so the most recent invitation lands
// at the top. Taxpayer identity is intentionally NOT joined here; the
// list-page UI fetches identity facts per-filing in a follow-up query
// (RLS lets the reviewer read tax_facts via member-read).
export async function listReviewableFilings(
  supabase: SupabaseClient,
): Promise<ReviewableFilingRow[]> {
  const { data, error } = await supabase
    .from("filings")
    .select(
      "id, tax_year, status, created_at, filing_members!inner(role, revoked_at)",
    )
    .eq("filing_members.role", "cpa_reviewer")
    .is("filing_members.revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`listReviewableFilings failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<
    ReviewableFilingDbRow & { filing_members: unknown }
  >;
  return rows.map((r) => ({
    id: r.id,
    taxYear: r.tax_year,
    status: r.status,
    createdAt: r.created_at,
  }));
}
