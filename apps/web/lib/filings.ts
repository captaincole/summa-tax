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

interface FilingDbRow {
  id: string;
  tax_year: number;
  status: string;
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
