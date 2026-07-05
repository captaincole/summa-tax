import { authHeaders } from "@/lib/auth";
import { agentUrl } from "@/lib/agentBase";
import { UnauthorizedError, type FormSummary } from "@/lib/api";

// CPA-side helpers: client-side fetchers for the agent's CPA endpoints plus
// shared types. The direct table reads (directory, invites, taxpayer names)
// moved to lib/serverDb.ts — they query the libsql app DB, server-side only.

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

export interface TaxpayerName {
  firstName: string | null;
  lastName: string | null;
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
