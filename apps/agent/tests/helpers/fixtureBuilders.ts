// Small constructor helpers for building TaxFactRow / AIDecisionRow
// fixtures with sensible defaults. Pulled out so every scenario's
// facts.ts / decisions.ts stays focused on the values, not the row
// scaffolding.

import type { TaxFactRow } from "../../src/mastra/db/taxFacts.js";
import type { AIDecisionRow } from "../../src/mastra/db/aiDecisions.js";

const DEFAULT_CREATED_AT = "2026-04-29T00:00:00Z";

/** Build an `identity.<suffix>` text fact (single string value). */
export function identityFact(opts: {
  userId: string;
  taxYear: number;
  suffix: string;
  value: string;
  sourceNote?: string;
}): TaxFactRow {
  return {
    id: `f-id-${opts.suffix.replace(/\./g, "-")}`,
    userId: opts.userId,
    taxYear: opts.taxYear,
    category: "identity",
    key: `identity.${opts.suffix}`,
    value: opts.value,
    sourceNote: opts.sourceNote ?? "verbal",
    createdAt: DEFAULT_CREATED_AT,
  };
}

/** Build an AIDecisionRow. Defaults to confidence "high" + verdict "accurate". */
export function decisionRow(opts: {
  userId: string;
  taxYear: number;
  key: string;
  decision: unknown;
  rationale: string;
  supportingFactKeys?: string[];
}): AIDecisionRow {
  return {
    id: `dec-${opts.key}`,
    userId: opts.userId,
    taxYear: opts.taxYear,
    decisionKey: opts.key,
    decision: opts.decision,
    rationale: opts.rationale,
    supportingFactKeys: opts.supportingFactKeys ?? [],
    confidence: "high",
    dissentingConsiderations: null,
    authorityCitations: null,
    sourceNote: null,
    createdAt: DEFAULT_CREATED_AT,
    verdict: "accurate",
    verdictReason: null,
    verdictAt: DEFAULT_CREATED_AT,
  };
}
