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
  type BaseLine,
  type DerivationContext,
  type DerivationResult,
  type EvaluatedForm,
} from "./types.js";
import { getTradeFacts, type TradeFact } from "../facts/index.js";

// What a Form 8949 row line carries as its value.
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

// What a Form 8949 box-totals line carries.
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

// ─── Line kinds for Form 8949 ────────────────────────────────────────────
// Each kind has a string discriminator (`lineKind`) and a value type that
// `result.value` is typed as when ok. Consumers narrow by lineKind:
//
//   if (line.lineKind === "form-8949.row" && line.result.ok) {
//     line.result.value;  // ← Form8949Row, fully typed, no cast
//   }

export interface Form8949RowLine extends BaseLine<Form8949Row> {
  lineKind: "form-8949.row";
  box: BoxId;
  rowIndex: number;
}

export interface Form8949TotalsLine extends BaseLine<Form8949BoxTotals> {
  lineKind: "form-8949.totals";
  box: BoxId;
}

// Emitted when a trade fact exists but its box-classification decision is
// missing. Carries the tradeId so the agent knows which decision to record.
// Always blocked (DerivationResult<never> means there's no successful value).
export interface Form8949UnclassifiedTradeLine extends BaseLine<never> {
  lineKind: "form-8949.unclassified-trade";
  tradeId: string;
}

export type Form8949Line =
  | Form8949RowLine
  | Form8949TotalsLine
  | Form8949UnclassifiedTradeLine;

export type EvaluatedForm8949 = EvaluatedForm<Form8949Line>;

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
  const lines: Form8949Line[] = [];

  // 1. Must-file evaluation
  const mustFile = mustFileForm8949(ctx);
  const baseForm: Omit<EvaluatedForm8949, "lines"> = {
    formId: "form-8949",
    jurisdiction: "federal",
    title: "Sales and Other Dispositions of Capital Assets",
    taxYear: ctx.taxYear,
    mustFile,
  };
  if (!mustFile.ok || !mustFile.value) {
    return { ...baseForm, lines };
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
  const blockedClassifications: Form8949UnclassifiedTradeLine[] = [];

  for (const fact of tradeFacts) {
    const { tradeId } = fact;
    const decisionKey = `decisions.trade.${tradeId}.form_8949_box`;
    const decision = ctx.decisions.get(decisionKey);

    if (!decision) {
      blockedClassifications.push({
        lineKind: "form-8949.unclassified-trade",
        lineId: `form-8949.unclassified.${tradeId}`,
        label: `Trade ${tradeId} — Form 8949 box assignment`,
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
        lineKind: "form-8949.unclassified-trade",
        lineId: `form-8949.unclassified.${tradeId}`,
        label: `Trade ${tradeId} — invalid box`,
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
  // those lines first so the engine can report them.
  if (blockedClassifications.length > 0) {
    return { ...baseForm, lines: blockedClassifications };
  }

  // 4. For each box that has trades, emit row lines + a totals line
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
      lines.push({
        lineKind: "form-8949.row",
        lineId: `form-8949.${box}.rows.${i}`,
        label: `${BOX_LABELS[box]} — row ${i + 1} (${trade.symbol ?? trade.description})`,
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
    lines.push({
      lineKind: "form-8949.totals",
      lineId: `form-8949.${box}.totals`,
      label: `${BOX_LABELS[box]} — totals`,
      box,
      result: ok<Form8949BoxTotals>(
        totals,
        `Sum of all rows in ${box}.`,
        inThisBox.map((c) => c.fact.sourceFact.key),
      ),
    });
  }

  return { ...baseForm, lines };
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
