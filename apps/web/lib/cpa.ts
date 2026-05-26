import type { SupabaseClient } from "@supabase/supabase-js";
import { authHeaders } from "@/lib/auth";
import { agentUrl } from "@/lib/agentBase";
import { UnauthorizedError, type FormSummary } from "@/lib/api";

// CPA-side helpers: taxpayer-name lookup (read directly from tax_facts via
// RLS) and the client-side fetcher for the read-only state endpoint
// (/app/cpa/filings/:filingId/state).

export interface CpaFilingState {
  filingId: string;
  taxYear: number;
  taxpayerFirstName: string | null;
  taxpayerLastName: string | null;
  authEmail: string | null;
  factCount: number;
  decisionCount: number;
  forms: FormSummary[];
  money: {
    totalWages: number;
    federalAgi: number;
    federalTaxableIncome: number;
    federalTax: number;
    federalWithholding: number;
    federalRefund: number;
    federalOwed: number;
    stateTax: number;
    stateWithholding: number;
    stateRefund: number;
    stateOwed: number;
  };
  documents: {
    form1040Url: string | null;
    form540Url: string | null;
    sidecarUrl: string | null;
  };
}

export async function fetchCpaFilingState(
  filingId: string,
): Promise<CpaFilingState> {
  const res = await fetch(
    agentUrl(`/app/cpa/filings/${encodeURIComponent(filingId)}/state`),
    { headers: await authHeaders() },
  );
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 403) throw new Error("forbidden");
  if (!res.ok) throw new Error(`CPA state fetch failed: ${res.status}`);
  return res.json();
}

export interface InviteCpaResult {
  ok: true;
  invitee: {
    userId: string;
    displayName: string;
  };
}

export interface InviteCpaError {
  ok: false;
  status: number;
  message: string;
}

// Invite a registered CPA to review a filing. Owner-only. The Share UI
// picks the CPA's userId from the directory listing (cpa_profiles), so we
// pass that directly — no email round-trip on the agent side. Returns a
// discriminated union so the caller can branch on success/failure without
// catching thrown errors.
export async function inviteCpa(
  filingId: string,
  userId: string,
): Promise<InviteCpaResult | InviteCpaError> {
  const res = await fetch(
    agentUrl(`/app/filings/${encodeURIComponent(filingId)}/invite-cpa`),
    {
      method: "POST",
      headers: {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId }),
    },
  );
  if (res.status === 401) throw new UnauthorizedError();
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok && (body as InviteCpaResult | null)?.ok) {
    return body as InviteCpaResult;
  }
  const message =
    (body as { error?: string } | null)?.error ??
    `invite failed (HTTP ${res.status})`;
  return { ok: false, status: res.status, message };
}

// Directory of every registered CPA on the platform. Backed by cpa_profiles,
// readable to any authenticated user (see migration 20260526173042). The
// Share page renders this as a grid the owner picks from.
export interface CpaDirectoryEntry {
  userId: string;
  displayName: string;
  firm: string | null;
  licenseNumber: string | null;
}

export async function listCpaDirectory(
  supabase: SupabaseClient,
): Promise<CpaDirectoryEntry[]> {
  const { data, error } = await supabase
    .from("cpa_profiles")
    .select("user_id, display_name, firm, license_number")
    .order("display_name", { ascending: true });
  if (error) {
    throw new Error(`listCpaDirectory failed: ${error.message}`);
  }
  return ((data ?? []) as Array<{
    user_id: string;
    display_name: string;
    firm: string | null;
    license_number: string | null;
  }>).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    firm: r.firm,
    licenseNumber: r.license_number,
  }));
}

// Invite-history for one filing. Owner-only via RLS on filing_invites —
// queries from a non-owner return empty. The Share page joins this against
// the directory by user_id to flag already-invited CPAs in the picker.
export interface FilingInviteRow {
  inviteeUserId: string;
  status: "pending" | "accepted" | "revoked";
  invitedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export async function listFilingInvites(
  supabase: SupabaseClient,
  filingId: string,
): Promise<FilingInviteRow[]> {
  const { data, error } = await supabase
    .from("filing_invites")
    .select(
      "invitee_user_id, status, invited_at, accepted_at, revoked_at",
    )
    .eq("filing_id", filingId)
    .order("invited_at", { ascending: false });
  if (error) {
    throw new Error(`listFilingInvites failed: ${error.message}`);
  }
  return ((data ?? []) as Array<{
    invitee_user_id: string;
    status: "pending" | "accepted" | "revoked";
    invited_at: string;
    accepted_at: string | null;
    revoked_at: string | null;
  }>).map((r) => ({
    inviteeUserId: r.invitee_user_id,
    status: r.status,
    invitedAt: r.invited_at,
    acceptedAt: r.accepted_at,
    revokedAt: r.revoked_at,
  }));
}

interface TaxpayerName {
  firstName: string | null;
  lastName: string | null;
}

// Pulls identity.name.{first,last} tax_facts for a filing. RLS lets the
// caller read these as long as they're a non-revoked member (owner or
// reviewer) — no service-role needed. Returns nulls when facts haven't
// been captured yet.
//
// Two facts in a single query: PostgREST in() filter on fact_key returns
// both rows in one round-trip. Each fact_value is a JSONB blob; identity
// names are stored as strings.
export async function taxpayerNameForFiling(
  supabase: SupabaseClient,
  filingId: string,
): Promise<TaxpayerName> {
  const { data, error } = await supabase
    .from("tax_facts")
    .select("fact_key, fact_value")
    .eq("filing_id", filingId)
    .in("fact_key", ["identity.name.first", "identity.name.last"]);
  if (error) {
    // Don't throw — a missing name shouldn't break the list page. Log + null.
    console.warn(`[cpa] taxpayer name lookup failed: ${error.message}`);
    return { firstName: null, lastName: null };
  }
  const byKey = new Map<string, unknown>();
  for (const row of (data ?? []) as Array<{ fact_key: string; fact_value: unknown }>) {
    byKey.set(row.fact_key, row.fact_value);
  }
  return {
    firstName: stringValue(byKey.get("identity.name.first")),
    lastName: stringValue(byKey.get("identity.name.last")),
  };
}

function stringValue(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function formatTaxpayerLabel(
  name: TaxpayerName,
  filingId: string,
): string {
  const parts = [name.firstName, name.lastName].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  // Fall back to a short filing id so the card still has a stable label.
  return `Filing ${filingId.slice(0, 8)}`;
}
