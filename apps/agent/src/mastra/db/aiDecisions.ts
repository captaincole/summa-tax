import type { InValue, Row } from "@libsql/client";
import {
  getAppDb,
  ensureAppSchema,
  type Scope,
  asStr,
  asStrOrNull,
  asNum,
  asJson,
  nowIso,
} from "./appDb";

// All helpers take an explicit Scope { userId, filingId } — the replacement
// for the RLS policies that scoped these queries in Postgres. Reads filter on
// filing_id; writes stamp both user_id and filing_id.

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

function rowToDecision(r: Row): AIDecisionRow {
  const supporting = asJson(r.supporting_fact_keys);
  return {
    id: asStr(r.id),
    userId: asStr(r.user_id),
    taxYear: asNum(r.tax_year),
    decisionKey: asStr(r.decision_key),
    decision: asJson(r.decision),
    rationale: asStr(r.rationale),
    supportingFactKeys: Array.isArray(supporting)
      ? (supporting as string[])
      : [],
    confidence: asStr(r.confidence) as Confidence,
    dissentingConsiderations: asStrOrNull(r.dissenting_considerations),
    authorityCitations: asJson(r.authority_citations) as
      | AuthorityCitation[]
      | null,
    sourceNote: asStrOrNull(r.source_note),
    createdAt: asStr(r.created_at),
    verdict: asStrOrNull(r.verdict) as Verdict | null,
    verdictReason: asStrOrNull(r.verdict_reason),
    verdictAt: asStrOrNull(r.verdict_at),
  };
}

export async function recordDecision(
  scope: Scope,
  d: AIDecision,
): Promise<void> {
  await ensureAppSchema();
  await getAppDb().execute({
    sql: `INSERT INTO ai_decisions
            (id, user_id, filing_id, tax_year, decision_key, decision, rationale,
             supporting_fact_keys, confidence, dissenting_considerations,
             authority_citations, source_note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      d.id,
      d.userId,
      d.filingId,
      d.taxYear,
      d.decisionKey,
      JSON.stringify(d.decision ?? null),
      d.rationale,
      JSON.stringify(d.supportingFactKeys),
      d.confidence,
      d.dissentingConsiderations ?? null,
      d.authorityCitations ? JSON.stringify(d.authorityCitations) : null,
      d.sourceNote ?? null,
      nowIso(),
    ],
  });
  void scope;
}

export interface ListDecisionsOpts {
  filingId?: string;
  taxYear?: number;
  decisionKey?: string;
  limit?: number;
}

export async function listDecisions(
  scope: Scope,
  opts: ListDecisionsOpts = {},
): Promise<AIDecisionRow[]> {
  await ensureAppSchema();
  const conds: string[] = ["filing_id = ?"];
  const args: InValue[] = [opts.filingId ?? scope.filingId];
  if (opts.taxYear !== undefined) {
    conds.push("tax_year = ?");
    args.push(opts.taxYear);
  }
  if (opts.decisionKey) {
    conds.push("decision_key = ?");
    args.push(opts.decisionKey);
  }
  args.push(Math.min(opts.limit ?? 100, 500));
  const res = await getAppDb().execute({
    sql: `SELECT * FROM ai_decisions WHERE ${conds.join(" AND ")}
          ORDER BY created_at DESC LIMIT ?`,
    args,
  });
  return res.rows.map(rowToDecision);
}

export async function getDecisionById(
  scope: Scope,
  id: string,
): Promise<AIDecisionRow | null> {
  await ensureAppSchema();
  const res = await getAppDb().execute({
    sql: `SELECT * FROM ai_decisions WHERE id = ? AND filing_id = ? LIMIT 1`,
    args: [id, scope.filingId],
  });
  return res.rows[0] ? rowToDecision(res.rows[0]) : null;
}

export async function setDecisionVerdict(
  scope: Scope,
  id: string,
  verdict: Verdict,
  reason: string,
  citations: AuthorityCitation[] | null,
): Promise<void> {
  await ensureAppSchema();
  await getAppDb().execute({
    sql: `UPDATE ai_decisions
          SET verdict = ?, verdict_reason = ?, verdict_at = ?, authority_citations = ?
          WHERE id = ? AND filing_id = ?`,
    args: [
      verdict,
      reason,
      nowIso(),
      citations ? JSON.stringify(citations) : null,
      id,
      scope.filingId,
    ],
  });
}
