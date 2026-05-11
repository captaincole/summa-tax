// Form 8949 — Sales and Other Dispositions of Capital Assets
//
// Structure: 6 boxes total. Part I is short-term (Boxes A/B/C),
// Part II is long-term (Boxes D/E/F). Within each box, rows of
// trades + a per-box totals row. Totals roll up to Schedule D.
//
// Per docs/architecture.md, classification → ai_decisions:
//   - Whether to file the form at all → decisions.scope.has_reportable_sales
//   - Per-trade box assignment       → decisions.trade.{tradeId}.form_8949_box
//
// The trade row values themselves (proceeds, basis, gain/loss, dates) are
// pure aggregation — they read straight off the trade fact.

import {
  ok,
  blocked,
  type BaseFormField,
  type DerivationContext,
  type DerivationResult,
  type EvaluatedForm,
} from "./types.js";
import { getTradeFacts, type TradeFact } from "../facts/index.js";

// What a Form 8949 row field carries as its value.
export interface Form8949Row {
  tradeId: string;
  description: string;           // (a)
  dateAcquired: string;          // (b)
  dateSold: string;              // (c)
  proceeds: number;              // (d)
  costBasis: number;             // (e)
  adjustmentCode?: string;       // (f)
  adjustmentAmount?: number;     // (g)
  gainLoss: number;              // (h) = (d) − (e) + (g)
}

// What a Form 8949 box-totals field carries.
export interface Form8949BoxTotals {
  rowCount: number;
  totalProceeds: number;
  totalCostBasis: number;
  totalAdjustments: number;
  totalGainLoss: number;
}

// 6 boxes, in print order.
const BOX_IDS = [
  "partI.boxA",  "partI.boxB",  "partI.boxC",
  "partII.boxD", "partII.boxE", "partII.boxF",
] as const;
export type BoxId = typeof BOX_IDS[number];

// ─── Field kinds for Form 8949 ───────────────────────────────────────────
// Each kind has a string discriminator (`formFieldKind`) and a value type
// that `result.value` is typed as when ok. Consumers narrow by formFieldKind:
//
//   if (field.formFieldKind === "form-8949.row" && field.result.ok) {
//     field.result.value;  // ← Form8949Row, fully typed, no cast
//   }

export interface Form8949RowField extends BaseFormField<Form8949Row> {
  formFieldKind: "form-8949.row";
  box: BoxId;
  rowIndex: number;
}

export interface Form8949TotalsField extends BaseFormField<Form8949BoxTotals> {
  formFieldKind: "form-8949.totals";
  box: BoxId;
}

// Emitted when a trade fact exists but its box-classification decision is
// missing. Carries the tradeId so the agent knows which decision to record.
// Always blocked (DerivationResult<never> means there's no successful value).
export interface Form8949UnclassifiedTradeField extends BaseFormField<never> {
  formFieldKind: "form-8949.unclassified-trade";
  tradeId: string;
}

export type Form8949Field =
  | Form8949RowField
  | Form8949TotalsField
  | Form8949UnclassifiedTradeField;

export type EvaluatedForm8949 = EvaluatedForm<Form8949Field>;

// Form 8949 is entirely about capital-sale income.
const FORM_8949_CATEGORY = "income" as const;

const BOX_LABELS: Record<BoxId, string> = {
  "partI.boxA":  "Short-term, basis reported to IRS (Box A)",
  "partI.boxB":  "Short-term, basis NOT reported to IRS (Box B)",
  "partI.boxC":  "Short-term, not reported on 1099-B (Box C)",
  "partII.boxD": "Long-term, basis reported to IRS (Box D)",
  "partII.boxE": "Long-term, basis NOT reported to IRS (Box E)",
  "partII.boxF": "Long-term, not reported on 1099-B (Box F)",
};

// ─── Evaluator ──────────────────────────────────────────────────────────

export function evaluateForm8949(ctx: DerivationContext): EvaluatedForm8949 {
  const fields: Form8949Field[] = [];

  // 1. Must-file evaluation
  const mustFile = mustFileForm8949(ctx);
  const baseForm: Omit<EvaluatedForm8949, "fields"> = {
    formId: "form-8949",
    jurisdiction: "federal",
    title: "Sales and Other Dispositions of Capital Assets",
    taxYear: ctx.taxYear,
    mustFile,
  };
  if (!mustFile.ok || !mustFile.value) {
    return { ...baseForm, fields };
  }

  // 2. Collect all trade facts via the typed catalog
  const tradeFacts = getTradeFacts(ctx.facts);

  // 3. Classify each trade into one of the 6 boxes via ai_decisions
  type ClassifiedTrade = {
    box: BoxId;
    boxDecisionKey: string;
    fact: TradeFact;
  };
  const classified: ClassifiedTrade[] = [];
  const blockedClassifications: Form8949UnclassifiedTradeField[] = [];

  for (const fact of tradeFacts) {
    const { tradeId } = fact;
    const decisionKey = `decisions.trade.${tradeId}.form_8949_box`;
    const decision = ctx.decisions.get(decisionKey);

    if (!decision) {
      blockedClassifications.push({
        formFieldKind: "form-8949.unclassified-trade",
        fieldId: `form-8949.unclassified.${tradeId}`,
        label: `Trade ${tradeId} — Form 8949 box assignment`,
        category: FORM_8949_CATEGORY,
        valueType: "single_select",
        tradeId,
        result: blocked(
          `Need Form 8949 box classification for trade ${tradeId}`,
          { decisionKey, factKeys: [fact.sourceFact.key] },
        ),
      });
      continue;
    }

    const box = decision.decision as BoxId;
    if (!BOX_IDS.includes(box)) {
      blockedClassifications.push({
        formFieldKind: "form-8949.unclassified-trade",
        fieldId: `form-8949.unclassified.${tradeId}`,
        label: `Trade ${tradeId} — invalid box`,
        category: FORM_8949_CATEGORY,
        valueType: "single_select",
        tradeId,
        result: blocked(
          `decision ${decisionKey} returned invalid box "${String(box)}"; expected one of ${BOX_IDS.join(", ")}`,
          { decisionKey },
        ),
      });
      continue;
    }

    classified.push({ box, boxDecisionKey: decisionKey, fact });
  }

  // If any trade can't be classified, the whole form is blocked. Surface
  // those fields first so the engine can report them.
  if (blockedClassifications.length > 0) {
    return { ...baseForm, fields: blockedClassifications };
  }

  // 4. For each box that has trades, emit row fields + a totals field
  for (const box of BOX_IDS) {
    const inThisBox = classified.filter((c) => c.box === box);
    if (inThisBox.length === 0) continue;

    inThisBox.forEach((c, i) => {
      const trade = c.fact.trade;
      const adjustment = trade.adjustmentAmount ?? 0;
      const row: Form8949Row = {
        tradeId: c.fact.tradeId,
        description: trade.description,
        dateAcquired: trade.dateAcquired,
        dateSold: trade.dateSold,
        proceeds: trade.proceeds,
        costBasis: trade.costBasis,
        adjustmentCode: trade.adjustmentCode,
        adjustmentAmount: trade.adjustmentAmount,
        gainLoss: trade.proceeds - trade.costBasis + adjustment,
      };
      fields.push({
        formFieldKind: "form-8949.row",
        fieldId: `form-8949.${box}.rows.${i}`,
        label: `${BOX_LABELS[box]} — row ${i + 1} (${trade.symbol ?? trade.description})`,
        category: FORM_8949_CATEGORY,
        valueType: "numeric",
        box,
        rowIndex: i,
        result: ok<Form8949Row>(
          row,
          `Trade row from broker-reported ${box}; gain/loss = proceeds − basis + adjustments.`,
          [c.fact.sourceFact.key],
          c.boxDecisionKey,
        ),
      });
    });

    const totals: Form8949BoxTotals = inThisBox.reduce<Form8949BoxTotals>(
      (acc, c) => {
        const trade = c.fact.trade;
        const adj = trade.adjustmentAmount ?? 0;
        acc.rowCount += 1;
        acc.totalProceeds += trade.proceeds;
        acc.totalCostBasis += trade.costBasis;
        acc.totalAdjustments += adj;
        acc.totalGainLoss += trade.proceeds - trade.costBasis + adj;
        return acc;
      },
      { rowCount: 0, totalProceeds: 0, totalCostBasis: 0, totalAdjustments: 0, totalGainLoss: 0 },
    );
    fields.push({
      formFieldKind: "form-8949.totals",
      fieldId: `form-8949.${box}.totals`,
      label: `${BOX_LABELS[box]} — totals`,
      category: FORM_8949_CATEGORY,
      valueType: "numeric",
      box,
      result: ok<Form8949BoxTotals>(
        totals,
        `Sum of all rows in ${box}.`,
        inThisBox.map((c) => c.fact.sourceFact.key),
      ),
    });
  }

  return { ...baseForm, fields };
}

// ─── must-file: defers to scope decision ─────────────────────────────────

function mustFileForm8949(ctx: DerivationContext): DerivationResult<boolean> {
  const decision = ctx.decisions.get("decisions.scope.has_reportable_sales");
  if (!decision) {
    return blocked(
      "Need scope decision: has_reportable_sales",
      { decisionKey: "decisions.scope.has_reportable_sales" },
    );
  }
  return ok<boolean>(
    decision.decision === true,
    `Form 8949 required when reportable sales exist. Scope decision: ${decision.rationale}`,
    decision.supportingFactKeys,
    "decisions.scope.has_reportable_sales",
  );
}
