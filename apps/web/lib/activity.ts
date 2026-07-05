// Activity-feed types + the browser-side fetcher. Domain data lives in the
// libsql app DB on the server, so the browser reads it through the
// /api/activity Route Handler (which authenticates via the Supabase session
// cookie and queries lib/serverDb.ts). The old Supabase Realtime channel is
// gone — ActivityCard polls this endpoint on a short interval instead.
//
// tax_facts and ai_decisions are append-only across both tables; no dedup
// here. The case engine handles latest-value collapsing elsewhere.

export type ActivityKind = "fact" | "decision";
// `ungroundable` is preserved for old rows written by the legacy single-agent
// reviewer. New rows from the review-decision workflow use `needs_more_facts`
// instead. `pending` is the initial state set by record-ai-decision while the
// background review is in flight.
export type Verdict =
  | "pending"
  | "accurate"
  | "inaccurate"
  | "ungroundable"
  | "needs_more_facts"
  | "review_failed";
export type Confidence = "low" | "medium" | "high";

export interface ActivityItem {
  kind: ActivityKind;
  id: string;
  createdAt: string;
  title: string;
  value: unknown;
  sourceNote: string | null;
  category?: string;
  rationale?: string;
  supportingFactKeys?: string[];
  confidence?: Confidence;
  verdict?: Verdict | null;
  verdictReason?: string | null;
}

const DEMO_TAX_YEAR = 2025;
export const ACTIVITY_TAX_YEAR = DEMO_TAX_YEAR;

export async function fetchActivityItems(limit = 50): Promise<ActivityItem[]> {
  const res = await fetch(`/api/activity?limit=${limit}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`activity fetch failed: ${res.status}`);
  return (await res.json()) as ActivityItem[];
}
