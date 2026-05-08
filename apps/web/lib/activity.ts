import type { SupabaseClient } from "@supabase/supabase-js";

// Mirrors the agent's /app/activity payload. Works with either the browser
// or server Supabase client — RLS scopes both reads to the authenticated
// user, no manual user_id filter.
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

// Raw column shape coming back from supabase-js / postgres_changes payloads.
// We accept Record<string, unknown> because the realtime payload type isn't
// generic over the row, and casting site-by-site at the call point is noisier.
type Row = Record<string, unknown>;

export function factRowToItem(row: Row): ActivityItem {
  return {
    kind: "fact",
    id: row.id as string,
    createdAt: row.created_at as string,
    title: row.fact_key as string,
    category: row.category as string,
    value: row.fact_value,
    sourceNote: (row.source_note as string | null) ?? null,
  };
}

export function decisionRowToItem(row: Row): ActivityItem {
  return {
    kind: "decision",
    id: row.id as string,
    createdAt: row.created_at as string,
    title: row.decision_key as string,
    value: row.decision,
    sourceNote: (row.source_note as string | null) ?? null,
    rationale: (row.rationale as string | undefined) ?? undefined,
    supportingFactKeys:
      (row.supporting_fact_keys as string[] | undefined) ?? undefined,
    confidence: (row.confidence as Confidence | undefined) ?? undefined,
    verdict: (row.verdict as Verdict | null | undefined) ?? null,
    verdictReason: (row.verdict_reason as string | null | undefined) ?? null,
  };
}

export async function fetchActivityItems(
  supabase: SupabaseClient,
  limit = 50,
): Promise<ActivityItem[]> {
  const safeLimit = Math.min(limit, 200);

  const [factsRes, decisionsRes] = await Promise.all([
    supabase
      .from("tax_facts")
      .select("id, created_at, fact_key, category, fact_value, source_note")
      .eq("tax_year", DEMO_TAX_YEAR)
      .order("created_at", { ascending: false })
      .limit(safeLimit),
    supabase
      .from("ai_decisions")
      .select(
        "id, created_at, decision_key, decision, rationale, supporting_fact_keys, confidence, verdict, verdict_reason, source_note",
      )
      .eq("tax_year", DEMO_TAX_YEAR)
      .order("created_at", { ascending: false })
      .limit(safeLimit),
  ]);

  if (factsRes.error) throw new Error(`activity facts: ${factsRes.error.message}`);
  if (decisionsRes.error)
    throw new Error(`activity decisions: ${decisionsRes.error.message}`);

  const factItems = (factsRes.data ?? []).map(factRowToItem);
  const decisionItems = (decisionsRes.data ?? []).map(decisionRowToItem);

  return [...factItems, ...decisionItems]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, safeLimit);
}
