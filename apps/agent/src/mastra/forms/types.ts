// Core types for the Form Engine. Every form gets an evaluator function that
// takes a DerivationContext (facts + decisions) and returns an EvaluatedForm
// (mustFile result + per-field results). Evaluators are pure functions —
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
  /**
   * When true, this is an engine gap — we haven't built support for this
   * field yet (no example scenario, no fact ingestion path). caseState
   * filters unsupported results out of pendingDecisions / pendingFacts so
   * Thom doesn't ask the user for input on fields we just don't compute
   * yet. The `fromFields` rule treats unsupported terms as 0 so downstream
   * sums continue without propagating the gap.
   */
  unsupported?: boolean;
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

/**
 * Build a result that marks the field as unsupported — engine gap, not
 * user-input gap. Surfaces as blocked everywhere a value would be needed
 * (e.g. PDF rendering), but caseState skips it when aggregating pending
 * questions for Thom.
 */
export const unsupported = (reason: string): DerivationBlocked => ({
  ok: false,
  reason,
  unsupported: true,
});

// ─── Context passed into every derivation ────────────────────────────────

export interface DerivationContext {
  taxYear: number;
  facts: FactsView;
  decisions: DecisionsView;
  /**
   * Cross-form / cross-field lookup. Returns the previously-evaluated result
   * for a (formId, fieldId), or undefined if not yet evaluated. The engine
   * topologically schedules form/field evaluations; if you call this for a
   * field that hasn't been evaluated yet, it's a programming error in the
   * form spec, not a missing-data condition.
   */
  formValues?: (formId: string, fieldId: string) => DerivationResult<unknown> | undefined;
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

// ─── Category + value-type taxonomy used by every form field ─────────────
//
// Category is the user-facing bucket each field rolls up into for the
// Filing Status panel. Every FormField declares one — TypeScript enforces
// it, so a new field can't be added without classifying it.
//
// FieldValueType describes the shape of the field's value, which drives
// rendering and (eventually) UI input semantics. A single-select reads from
// a decision; a numeric reads from a numeric derivation; a text reads
// straight from an identity fact, etc.

export type Category =
  | "personal_info"        // taxpayer name, SSN, address, DOB — top-of-form header bits
  | "filing_scope"         // filing status, residency, must-file decisions
  | "income"               // wages, dividends, capital gains, withholding
  | "deductions_credits"   // standard deduction, taxable income, tax, credits, payments
  | "other";

export type FieldValueType =
  | "numeric"
  | "single_select"
  | "multi_select"
  | "text"
  | "boolean"
  | "date";

// ─── Evaluated form / field shapes ───────────────────────────────────────
//
// Fields use a discriminated union: each form declares its own field kinds,
// each kind tagged with a string `formFieldKind` and parameterized on a
// value type V. Consumers narrow by formFieldKind to get a strongly-typed
// value with no casts.
//
// Example shape per form (declared in form8949.ts etc.):
//   interface Form8949RowField extends BaseFormField<Form8949Row> {
//     formFieldKind: "form-8949.row"; box: BoxId; rowIndex: number;
//   }
//   interface Form8949TotalsField extends BaseFormField<Form8949BoxTotals> {
//     formFieldKind: "form-8949.totals"; box: BoxId;
//   }
//   type Form8949Field = Form8949RowField | Form8949TotalsField | …;
//
// Each form's evaluator returns EvaluatedForm<TheirFieldUnion>.

export interface BaseFormField<V = unknown> {
  fieldId: string;
  label: string;
  /** Which UI bucket this field belongs to (Filing Status panel rollup). */
  category: Category;
  /** Shape of the field's value — informs rendering and input semantics. */
  valueType: FieldValueType;
  result: DerivationResult<V>;
}

/**
 * Loosest possible field shape — what generic engine code (e.g., a registry
 * holding heterogeneous forms) gets when it doesn't know which form it's
 * looking at. Specific consumers should always know the form's concrete
 * field union and not see this type.
 */
export type AnyFormField = BaseFormField & { formFieldKind: string };

export interface EvaluatedForm<F extends BaseFormField = AnyFormField> {
  formId: string;
  jurisdiction: string;            // "federal" | "state-ca" | …
  title: string;
  taxYear: number;
  mustFile: DerivationResult<boolean>;
  fields: F[];
}

export type FormEvaluator<F extends BaseFormField = AnyFormField> =
  (ctx: DerivationContext) => EvaluatedForm<F>;

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
