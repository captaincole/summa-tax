// The engine's input vocabulary — the shapes of the fact and decision rows
// that evaluateScenario consumes. Defined HERE, not in the db layer, so the
// dependency arrow points one way: the engine says what a fact IS, the
// mastra/db modules merely persist and load that shape (they import these
// types and re-export them for their own callers).
//
// Boundary rule: nothing in src/engine/ imports from outside src/engine/
// (see ../README.md). These definitions are what make that possible.

export type Confidence = "low" | "medium" | "high";

// Verdicts come from two paths:
//   - the legacy single-agent reviewer (pre-workflow): accurate | inaccurate
//     | ungroundable | review_failed
//   - the multi-step review-decision workflow: accurate | inaccurate
//     | needs_more_facts | review_failed
// `ungroundable` is preserved for backward-compatibility with rows written by
// the old reviewer; new runs write `needs_more_facts` instead.
//
// `pending` is the initial state set by record-ai-decision when it kicks the
// review off as a background task — the row gets re-stamped by the
// workflow's finalizeStep when it completes (typically a few seconds to a
// minute later).
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

export interface TaxFactRow {
  id: string;
  userId: string;
  taxYear: number;
  category: string;
  key: string;
  value: unknown;
  sourceNote: string | null;
  createdAt: string;
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
