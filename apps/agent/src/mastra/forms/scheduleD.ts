// Schedule D — Capital Gains and Losses
//
// Aggregates Form 8949 box totals into IRS line numbers, sums Part I and
// Part II, and produces line 16 (net capital gain/loss) which feeds 1040
// line 7.
//
// Cross-form reference: takes the EvaluatedForm8949 as a parameter rather
// than going through a generic engine. Two-form dependency graphs don't
// justify orchestration plumbing yet — see docs/architecture.md for when
// we'll switch to a topo-sort engine.
//
// For Alejandro's slice we populate:
//   line 1a (ST Box A from Form 8949)
//   line 7  (net short-term, sum of Part I)
//   line 8a (LT Box D from Form 8949)
//   line 15 (net long-term, sum of Part II)
//   line 16 (line 7 + line 15)
// Other lines (1b, 2, 3, 4-6, 8b, 9, 10, 11-14) implicitly zero. We'll
// emit them once we have the data sources (K-1, cap gain distributions,
// loss carryovers, etc.) — all later scenarios.

import {
  ok,
  blocked,
  type BaseFormField,
  type DerivationContext,
  type DerivationResult,
  type EvaluatedForm,
} from "./types.js";
import type {
  BoxId,
  EvaluatedForm8949,
  Form8949BoxTotals,
  Form8949TotalsField,
} from "./form8949.js";

// ─── Value types ─────────────────────────────────────────────────────────

/** Fields that aggregate a Form 8949 box (1a, 1b, 2, 3, 8a, 8b, 9, 10).
 *  Carries the four columns the form prints: proceeds, basis, adjustments,
 *  gain/loss. */
export interface ScheduleDAggregateValue {
  proceeds: number;
  costBasis: number;
  adjustments: number;
  gainLoss: number;
}

// ─── Field kinds ─────────────────────────────────────────────────────────

export type ScheduleDAggregateLineNumber =
  | "1a" | "1b" | "2" | "3"   // Part I (short-term)
  | "8a" | "8b" | "9" | "10"; // Part II (long-term)

export type ScheduleDSingleValueLineNumber =
  | "4" | "5" | "6" | "7"          // remainder of Part I
  | "11" | "12" | "13" | "14" | "15" // remainder of Part II
  | "16";                          // Part III summary

export interface ScheduleDAggregateField extends BaseFormField<ScheduleDAggregateValue> {
  formFieldKind: "schedule-d.aggregate";
  lineNumber: ScheduleDAggregateLineNumber;
  part: "I" | "II";
}

export interface ScheduleDSingleValueField extends BaseFormField<number> {
  formFieldKind: "schedule-d.single";
  lineNumber: ScheduleDSingleValueLineNumber;
  part: "I" | "II" | "III";
}

export type ScheduleDField = ScheduleDAggregateField | ScheduleDSingleValueField;

export type EvaluatedScheduleD = EvaluatedForm<ScheduleDField>;

// Schedule D rolls up capital activity — entirely an income-category form.
const SCHEDULE_D_CATEGORY = "income" as const;

// ─── Evaluator ───────────────────────────────────────────────────────────

export function evaluateScheduleD(
  ctx: DerivationContext,
  form8949: EvaluatedForm8949,
): EvaluatedScheduleD {
  const fields: ScheduleDField[] = [];

  const mustFile = mustFileScheduleD(ctx);
  const baseForm: Omit<EvaluatedScheduleD, "fields"> = {
    formId: "schedule-d",
    jurisdiction: "federal",
    title: "Capital Gains and Losses",
    taxYear: ctx.taxYear,
    mustFile,
  };
  if (!mustFile.ok || !mustFile.value) {
    return { ...baseForm, fields };
  }

  // Pull Form 8949 box totals. Returns null if the box has no rows (Form 8949
  // skips empty boxes) — that's fine, treat as zero on Schedule D's side.
  // Type predicate is needed because Array.prototype.find can't carry the
  // formFieldKind narrowing from an inline arrow function.
  const boxTotals = (box: BoxId): Form8949BoxTotals | null => {
    const totalsField = form8949.fields.find(
      (l): l is Form8949TotalsField =>
        l.formFieldKind === "form-8949.totals" && l.box === box,
    );
    if (!totalsField || !totalsField.result.ok) return null;
    return totalsField.result.value;
  };

  // Collect supporting fact keys from a box's row fields for traceability.
  const boxFactKeys = (box: BoxId): string[] => {
    const out: string[] = [];
    for (const l of form8949.fields) {
      if (l.formFieldKind === "form-8949.row" && l.box === box && l.result.ok) {
        for (const k of l.result.supportingFactKeys) out.push(k);
      }
    }
    return out;
  };

  // ─── Part I: Short-term ───
  const boxA = boxTotals("partI.boxA");
  // Line 1a — short-term, Box A (basis reported, no adjustments needed)
  if (boxA && boxA.totalAdjustments === 0) {
    fields.push({
      formFieldKind: "schedule-d.aggregate",
      lineNumber: "1a",
      part: "I",
      fieldId: "schedule-d.line.1a",
      label: "Totals for short-term transactions reported on Form 8949 with Box A checked",
      category: SCHEDULE_D_CATEGORY,
      valueType: "numeric",
      result: ok<ScheduleDAggregateValue>(
        {
          proceeds: boxA.totalProceeds,
          costBasis: boxA.totalCostBasis,
          adjustments: 0,
          gainLoss: boxA.totalGainLoss,
        },
        "Aggregated from Form 8949 Part I Box A totals (no adjustments).",
        boxFactKeys("partI.boxA"),
      ),
    });
  }
  // (lines 1b / 2 / 3 / 4 / 5 / 6 not yet emitted — see header note)

  // Line 7 — net short-term: sum of (h) gain/loss from lines 1a-6
  const stGain = (boxA?.totalGainLoss ?? 0);
  // (when 1b/2/3/4/5/6 land, add them to stGain here)
  fields.push({
    formFieldKind: "schedule-d.single",
    lineNumber: "7",
    part: "I",
    fieldId: "schedule-d.line.7",
    label: "Net short-term capital gain or (loss). Combine lines 1a through 6 in column (h)",
    category: SCHEDULE_D_CATEGORY,
    valueType: "numeric",
    result: ok<number>(
      stGain,
      "Sum of column (h) across Part I lines (currently only line 1a is populated).",
      boxFactKeys("partI.boxA"),
    ),
  });

  // ─── Part II: Long-term ───
  const boxD = boxTotals("partII.boxD");
  // Line 8a — long-term, Box D (basis reported, no adjustments)
  if (boxD && boxD.totalAdjustments === 0) {
    fields.push({
      formFieldKind: "schedule-d.aggregate",
      lineNumber: "8a",
      part: "II",
      fieldId: "schedule-d.line.8a",
      label: "Totals for long-term transactions reported on Form 8949 with Box D checked",
      category: SCHEDULE_D_CATEGORY,
      valueType: "numeric",
      result: ok<ScheduleDAggregateValue>(
        {
          proceeds: boxD.totalProceeds,
          costBasis: boxD.totalCostBasis,
          adjustments: 0,
          gainLoss: boxD.totalGainLoss,
        },
        "Aggregated from Form 8949 Part II Box D totals (no adjustments).",
        boxFactKeys("partII.boxD"),
      ),
    });
  }
  // (lines 8b / 9 / 10 / 11 / 12 / 13 / 14 not yet emitted)

  // Line 15 — net long-term
  const ltGain = (boxD?.totalGainLoss ?? 0);
  fields.push({
    formFieldKind: "schedule-d.single",
    lineNumber: "15",
    part: "II",
    fieldId: "schedule-d.line.15",
    label: "Net long-term capital gain or (loss). Combine lines 8a through 14 in column (h)",
    category: SCHEDULE_D_CATEGORY,
    valueType: "numeric",
    result: ok<number>(
      ltGain,
      "Sum of column (h) across Part II lines (currently only line 8a is populated).",
      boxFactKeys("partII.boxD"),
    ),
  });

  // ─── Part III: Summary ───
  // Line 16 — combine line 7 and line 15. Goes onto 1040 line 7.
  const netCapitalGain = stGain + ltGain;
  fields.push({
    formFieldKind: "schedule-d.single",
    lineNumber: "16",
    part: "III",
    fieldId: "schedule-d.line.16",
    label: "Combine lines 7 and 15 — net capital gain or (loss). Enter on Form 1040 line 7",
    category: SCHEDULE_D_CATEGORY,
    valueType: "numeric",
    result: ok<number>(
      netCapitalGain,
      "Line 7 (net short-term) + Line 15 (net long-term).",
      [...boxFactKeys("partI.boxA"), ...boxFactKeys("partII.boxD")],
    ),
  });

  return { ...baseForm, fields };
}

// ─── must-file ───────────────────────────────────────────────────────────

function mustFileScheduleD(ctx: DerivationContext): DerivationResult<boolean> {
  // Schedule D is required when there are reportable capital sales OR
  // capital gain distributions (1099-DIV box 2a). We currently only have
  // the sales scope decision; cap-gain-distributions scope decision will
  // be added when the first scenario uses it. OR-ing two scope decisions
  // happens here in code (mechanical aggregation of decisions, not a new
  // judgment call).
  const sales = ctx.decisions.get("decisions.scope.has_reportable_sales");
  if (!sales) {
    return blocked("Need scope decision: has_reportable_sales", {
      decisionKey: "decisions.scope.has_reportable_sales",
    });
  }
  return ok<boolean>(
    sales.decision === true,
    `Schedule D required when reportable sales or cap-gain distributions exist. ${sales.rationale}`,
    sales.supportingFactKeys,
    "decisions.scope.has_reportable_sales",
  );
}
