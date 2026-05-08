import type { SupabaseClient } from "@supabase/supabase-js";

// Mirrors the agent's /app/activity payload. Works with either the browser
// or server Supabase client — RLS scopes both reads to the authenticated
// user, no manual user_id filter.
//
// tax_facts and ai_decisions are append-only across both tables; no dedup
// here. The case engine handles latest-value collapsing elsewhere.

export type ActivityKind = "fact" | "decision";
export type Verdict = "accurate" | "inaccurate" | "ungroundable" | "review_failed";
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

  const factItems: ActivityItem[] = (factsRes.data ?? []).map((f) => ({
    kind: "fact",
    id: f.id as string,
    createdAt: f.created_at as string,
    title: f.fact_key as string,
    category: f.category as string,
    value: f.fact_value as unknown,
    sourceNote: (f.source_note as string | null) ?? null,
  }));

  const decisionItems: ActivityItem[] = (decisionsRes.data ?? []).map((d) => ({
    kind: "decision",
    id: d.id as string,
    createdAt: d.created_at as string,
    title: d.decision_key as string,
    value: d.decision as unknown,
    sourceNote: (d.source_note as string | null) ?? null,
    rationale: (d.rationale as string | undefined) ?? undefined,
    supportingFactKeys: (d.supporting_fact_keys as string[] | undefined) ?? undefined,
    confidence: (d.confidence as Confidence | undefined) ?? undefined,
    verdict: (d.verdict as Verdict | null | undefined) ?? null,
    verdictReason: (d.verdict_reason as string | null | undefined) ?? null,
  }));

  return [...factItems, ...decisionItems]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, safeLimit);
}
