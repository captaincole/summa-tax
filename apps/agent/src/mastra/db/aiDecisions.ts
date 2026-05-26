import type { SupabaseClient } from "@supabase/supabase-js";

// All helpers take a user-scoped Supabase client. RLS on public.ai_decisions
// scopes reads/writes to auth.uid() automatically; we still pass user_id on
// inserts so RLS WITH CHECK validates it explicitly.

export type Confidence = "low" | "medium" | "high";
// Verdicts come from two paths:
//   - the legacy single-agent reviewer (Nynaeve direct): accurate | inaccurate
//     | ungroundable | review_failed
//   - the multi-step review-decision workflow: accurate | inaccurate
//     | needs_more_facts | review_failed
// `ungroundable` is preserved for backward-compatibility with rows written by
// the old reviewer; new runs write `needs_more_facts` instead.
//
// `pending` is the initial state set by record-ai-decision when it kicks the
// review off as a background task via waitUntil — the row gets re-stamped by
// the workflow's finalizeStep when it completes (typically a few seconds to
// a minute later).
export type Verdict =
  | "pending"
  | "accurate"
  | "inaccurate"
  | "ungroundable"
  | "needs_more_facts"
  | "review_failed";

export interface AuthorityCitation {
  blockId: string;
  quote?: string;
}

export interface AIDecision {
  id: string;
  userId: string;
  filingId: string;
  taxYear: number;
  decisionKey: string;
  decision: unknown;
  rationale: string;
  supportingFactKeys: string[];
  confidence: Confidence;
  dissentingConsiderations?: string;
  authorityCitations?: AuthorityCitation[];
  sourceNote?: string;
}

export interface AIDecisionRow {
  id: string;
  userId: string;
  taxYear: number;
  decisionKey: string;
  decision: unknown;
  rationale: string;
  supportingFactKeys: string[];
  confidence: Confidence;
  dissentingConsiderations: string | null;
  authorityCitations: AuthorityCitation[] | null;
  sourceNote: string | null;
  createdAt: string;
  verdict: Verdict | null;
  verdictReason: string | null;
  verdictAt: string | null;
}

interface AIDecisionDbRow {
  id: string;
  user_id: string;
  tax_year: number;
  decision_key: string;
  decision: unknown;
  rationale: string;
  supporting_fact_keys: unknown;
  confidence: string;
  dissenting_considerations: string | null;
  authority_citations: AuthorityCitation[] | null;
  source_note: string | null;
  created_at: string;
  verdict: string | null;
  verdict_reason: string | null;
  verdict_at: string | null;
}

function rowToDecision(r: AIDecisionDbRow): AIDecisionRow {
  return {
    id: r.id,
    userId: r.user_id,
    taxYear: r.tax_year,
    decisionKey: r.decision_key,
    decision: r.decision,
    rationale: r.rationale,
    supportingFactKeys: Array.isArray(r.supporting_fact_keys)
      ? (r.supporting_fact_keys as string[])
      : [],
    confidence: r.confidence as Confidence,
    dissentingConsiderations: r.dissenting_considerations,
    authorityCitations: r.authority_citations,
    sourceNote: r.source_note,
    createdAt: r.created_at,
    verdict: r.verdict as Verdict | null,
    verdictReason: r.verdict_reason,
    verdictAt: r.verdict_at,
  };
}

export async function recordDecision(
  supabase: SupabaseClient,
  d: AIDecision,
): Promise<void> {
  const { error } = await supabase.from("ai_decisions").insert({
    id: d.id,
    user_id: d.userId,
    filing_id: d.filingId,
    tax_year: d.taxYear,
    decision_key: d.decisionKey,
    decision: d.decision,
    rationale: d.rationale,
    supporting_fact_keys: d.supportingFactKeys,
    confidence: d.confidence,
    dissenting_considerations: d.dissentingConsiderations ?? null,
    authority_citations: d.authorityCitations ?? null,
    source_note: d.sourceNote ?? null,
  });
  if (error) throw new Error(`recordDecision failed: ${error.message}`);
}

export interface ListDecisionsOpts {
  filingId?: string;
  taxYear?: number;
  decisionKey?: string;
  limit?: number;
}

export async function listDecisions(
  supabase: SupabaseClient,
  opts: ListDecisionsOpts = {},
): Promise<AIDecisionRow[]> {
  let q = supabase
    .from("ai_decisions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(opts.limit ?? 100, 500));
  if (opts.filingId) q = q.eq("filing_id", opts.filingId);
  if (opts.taxYear !== undefined) q = q.eq("tax_year", opts.taxYear);
  if (opts.decisionKey) q = q.eq("decision_key", opts.decisionKey);
  const { data, error } = await q;
  if (error) throw new Error(`listDecisions failed: ${error.message}`);
  return ((data ?? []) as AIDecisionDbRow[]).map(rowToDecision);
}

export async function getDecisionById(
  supabase: SupabaseClient,
  id: string,
): Promise<AIDecisionRow | null> {
  const { data, error } = await supabase
    .from("ai_decisions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getDecisionById failed: ${error.message}`);
  return data ? rowToDecision(data as AIDecisionDbRow) : null;
}

export async function setDecisionVerdict(
  supabase: SupabaseClient,
  id: string,
  verdict: Verdict,
  reason: string,
  citations: AuthorityCitation[] | null,
): Promise<void> {
  const { error } = await supabase
    .from("ai_decisions")
    .update({
      verdict,
      verdict_reason: reason,
      verdict_at: new Date().toISOString(),
      authority_citations: citations,
    })
    .eq("id", id);
  if (error) throw new Error(`setDecisionVerdict failed: ${error.message}`);
}
