import type { SupabaseClient } from "@supabase/supabase-js";

// Returns helper. The list comes from the filings + filing_members tables —
// every owner filing the caller has is a TaxReturn. The URL slug stays the
// year string (e.g. "2025") because each user has at most one filing per
// tax_year today; the agent's appState route also keys threads + draft
// lookups by year. Filing UUID is carried in the TaxReturn for callers
// that need it (e.g. resolving the share page).
//
// `realDataAvailable` is kept on the type because a handful of /r/* pages
// still branch on it. With the query-based world every TaxReturn is real,
// so the field is always `true`. The dead-code branches are intentional
// short-term — they will get pruned in a follow-up sweep alongside the
// rest of the per-page placeholder handling.

export type ReturnState = "active" | "filed";

export interface TaxReturn {
  id: string;
  year: number;
  filingId: string;
  label: string;
  state: ReturnState;
  realDataAvailable: boolean;
  status: string;
}

interface FilingRow {
  id: string;
  tax_year: number;
  status: string;
}

function rowToReturn(r: FilingRow): TaxReturn {
  const state: ReturnState = r.status === "filed" ? "filed" : "active";
  return {
    id: String(r.tax_year),
    year: r.tax_year,
    filingId: r.id,
    label: `${r.tax_year} Return`,
    state,
    realDataAvailable: true,
    status: r.status,
  };
}

// Every owner filing the caller has, newest year first. Empty array (not
// throw) when the caller owns no filings — home-home renders the empty-state
// CTA in that case.
export async function listOwnerReturns(
  supabase: SupabaseClient,
): Promise<TaxReturn[]> {
  const { data, error } = await supabase
    .from("filings")
    .select("id, tax_year, status, filing_members!inner(role, revoked_at)")
    .eq("filing_members.role", "owner")
    .is("filing_members.revoked_at", null)
    .order("tax_year", { ascending: false });
  if (error) {
    throw new Error(`listOwnerReturns failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<FilingRow & { filing_members: unknown }>;
  return rows.map(rowToReturn);
}

// Resolve a single owner return by year. Returns null when the caller has
// no owner filing for that year (route layout redirects to / in that case).
export async function getOwnerReturnByYear(
  supabase: SupabaseClient,
  taxYear: number,
): Promise<TaxReturn | null> {
  const { data, error } = await supabase
    .from("filings")
    .select("id, tax_year, status, filing_members!inner(role, revoked_at)")
    .eq("tax_year", taxYear)
    .eq("filing_members.role", "owner")
    .is("filing_members.revoked_at", null)
    .maybeSingle();
  if (error) {
    throw new Error(`getOwnerReturnByYear failed: ${error.message}`);
  }
  if (!data) return null;
  return rowToReturn(data as FilingRow & { filing_members: unknown });
}

// Deterministic per-user + per-return thread ID. Must match the format used
// by /app/state in apps/agent (no shared package yet — keep these in sync).
// We key by year (not filing UUID) so a reset that wipes-and-recreates the
// filing keeps a stable conversational thread for the user.
export function threadIdFor(userId: string, returnId: string): string {
  return `${userId}::${returnId}`;
}
