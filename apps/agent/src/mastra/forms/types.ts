// Core types for the Form Engine. Every form gets an evaluator function that
// takes a DerivationContext (facts + decisions) and returns an EvaluatedForm
// (mustFile result + per-line results). Evaluators are pure functions —
// deterministic given the input fact + decision state.
//
// Per docs/architecture.md the rules are:
//  - Pure aggregation (sums, math, table lookups) lives in code.
//  - Classification or judgment ALWAYS defers to an ai_decisions lookup,
//    even when the answer is obvious.
//  - Cross-form references go through ctx.formValues(...).

import type { TaxFactRow } from "../db/taxFacts.js";
import type { AIDecisionRow } from "../db/aiDecisions.js";

// ─── Result of evaluating a single derivation ────────────────────────────

export type DerivationResult<T> =
  | DerivationOk<T>
  | DerivationBlocked;

export interface DerivationOk<T> {
  ok: true;
  value: T;
  rationale: string;
  supportingFactKeys: string[];
  /** Set when the value came from an ai_decisions lookup. */
  decisionKey?: string;
}

export interface DerivationBlocked {
  ok: false;
  reason: string;
  /** Set when the block is "we need this decision recorded". */
  missingDecisionKey?: string;
  /** Set when the block is "we need these facts present". */
  missingFactKeys?: string[];
}

export const ok = <T>(
  value: T,
  rationale: string,
  supportingFactKeys: string[],
  decisionKey?: string,
): DerivationOk<T> => ({ ok: true, value, rationale, supportingFactKeys, decisionKey });

export const blocked = (
  reason: string,
  opts: { decisionKey?: string; factKeys?: string[] } = {},
): DerivationBlocked => ({
  ok: false,
  reason,
  missingDecisionKey: opts.decisionKey,
  missingFactKeys: opts.factKeys,
});

// ─── Context passed into every derivation ────────────────────────────────

export interface DerivationContext {
  taxYear: number;
  facts: FactsView;
  decisions: DecisionsView;
  /**
   * Cross-form / cross-line lookup. Returns the previously-evaluated result
   * for a (formId, lineId), or undefined if not yet evaluated. The engine
   * topologically schedules form/line evaluations; if you call this for a
   * line that hasn't been evaluated yet, it's a programming error in the
   * form spec, not a missing-data condition.
   */
  formValues?: (formId: string, lineId: string) => DerivationResult<unknown> | undefined;
}

export interface FactsView {
  get(key: string): TaxFactRow | undefined;
  byKeyPrefix(prefix: string): TaxFactRow[];
  byCategory(category: string): TaxFactRow[];
  all(): TaxFactRow[];
}

export interface DecisionsView {
  get(key: string): AIDecisionRow | undefined;
  byKeyPrefix(prefix: string): AIDecisionRow[];
}

// ─── Evaluated form / line shapes ────────────────────────────────────────
//
// Lines use a discriminated union: each form declares its own line kinds,
// each kind tagged with a string `lineKind` and parameterized on a value
// type V. Consumers narrow by lineKind to get a strongly-typed value with
// no casts.
//
// Example shape per form (declared in form8949.ts etc.):
//   interface Form8949RowLine extends BaseLine<Form8949Row> {
//     lineKind: "form-8949.row"; box: BoxId; rowIndex: number;
//   }
//   interface Form8949TotalsLine extends BaseLine<Form8949BoxTotals> {
//     lineKind: "form-8949.totals"; box: BoxId;
//   }
//   type Form8949Line = Form8949RowLine | Form8949TotalsLine | …;
//
// Each form's evaluator returns EvaluatedForm<TheirLineUnion>.

export interface BaseLine<V = unknown> {
  lineId: string;
  label: string;
  result: DerivationResult<V>;
}

/**
 * Loosest possible line shape — what generic engine code (e.g., a registry
 * holding heterogeneous forms) gets when it doesn't know which form it's
 * looking at. Specific consumers should always know the form's concrete
 * line union and not see this type.
 */
export type AnyLine = BaseLine & { lineKind: string };

export interface EvaluatedForm<L extends BaseLine = AnyLine> {
  formId: string;
  jurisdiction: string;            // "federal" | "state-ca" | …
  title: string;
  taxYear: number;
  mustFile: DerivationResult<boolean>;
  lines: L[];
}

export type FormEvaluator<L extends BaseLine = AnyLine> =
  (ctx: DerivationContext) => EvaluatedForm<L>;

// ─── In-memory view builders (used by tests + future engine wiring) ──────

export function makeFactsView(rows: TaxFactRow[]): FactsView {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return {
    get: (key) => byKey.get(key),
    byKeyPrefix: (prefix) => rows.filter((r) => r.key.startsWith(prefix)),
    byCategory: (category) => rows.filter((r) => r.category === category),
    all: () => rows,
  };
}

export function makeDecisionsView(rows: AIDecisionRow[]): DecisionsView {
  const byKey = new Map(rows.map((r) => [r.decisionKey, r]));
  return {
    get: (key) => byKey.get(key),
    byKeyPrefix: (prefix) => rows.filter((r) => r.decisionKey.startsWith(prefix)),
  };
}
