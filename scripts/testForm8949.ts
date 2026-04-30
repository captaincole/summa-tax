// Smoke test for Form 8949 evaluator. Builds an in-memory fact + decision
// fixture matching Alejandro's case (NVDA short-term + AAPL long-term, both
// covered) and asserts the evaluator produces the expected lines.
//
// Run: npx tsx scripts/testForm8949.ts

import { evaluateForm8949 } from "../src/mastra/forms/form8949.js";
import { makeTradeFactKey, type TradeFactValue } from "../src/mastra/facts/index.js";
import {
  makeDecisionsView,
  makeFactsView,
  type DerivationContext,
} from "../src/mastra/forms/types.js";
import type { TaxFactRow } from "../src/mastra/db/taxFacts.js";
import type { AIDecisionRow } from "../src/mastra/db/aiDecisions.js";

const TAX_YEAR = 2025;
const TAXPAYER_ID = "alejandro-fixture";
const ACCOUNT_SLUG = "apex-individual";

// ─── Fixture: Alejandro's two trades as TaxFactRows ──────────────────────

const aaplTrade: TradeFactValue = {
  tradeId: "aapl-2025-09-15",
  description: "APPLE INC",
  cusip: "037833100",
  symbol: "AAPL",
  quantity: 50,
  dateAcquired: "06/15/23",
  dateSold: "09/15/25",
  proceeds: 11500.00,
  costBasis: 9250.00,
};

const nvdaTrade: TradeFactValue = {
  tradeId: "nvda-2025-11-20",
  description: "NVIDIA CORP",
  cusip: "67066G104",
  symbol: "NVDA",
  quantity: 10,
  dateAcquired: "02/10/25",
  dateSold: "11/20/25",
  proceeds: 1650.00,
  costBasis: 1350.00,
};

const facts: TaxFactRow[] = [
  {
    id: "fact-1",
    taxpayerId: TAXPAYER_ID,
    year: TAX_YEAR,
    category: "investment_income",
    key: makeTradeFactKey(ACCOUNT_SLUG, aaplTrade.tradeId),
    value: aaplTrade,
    sourceNote: "Apex Securities consolidated 1099, Form 1099-B section, Long Term Covered",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "fact-2",
    taxpayerId: TAXPAYER_ID,
    year: TAX_YEAR,
    category: "investment_income",
    key: makeTradeFactKey(ACCOUNT_SLUG, nvdaTrade.tradeId),
    value: nvdaTrade,
    sourceNote: "Apex Securities consolidated 1099, Form 1099-B section, Short Term Covered",
    createdAt: "2026-04-29T00:00:00Z",
  },
];

// ─── Fixture: AI decisions ───────────────────────────────────────────────

const decisions: AIDecisionRow[] = [
  {
    id: "dec-1",
    taxpayerId: TAXPAYER_ID,
    year: TAX_YEAR,
    decisionKey: "decisions.scope.has_reportable_sales",
    decision: true,
    rationale:
      "Apex Securities consolidated 1099 includes a populated 1099-B section with two reportable sales (AAPL, NVDA).",
    supportingFactKeys: [
      makeTradeFactKey(ACCOUNT_SLUG, aaplTrade.tradeId),
      makeTradeFactKey(ACCOUNT_SLUG, nvdaTrade.tradeId),
    ],
    confidence: "high",
    dissentingConsiderations: null,
    authorityCitations: null,
    sourceNote: null,
    createdAt: "2026-04-29T00:00:00Z",
    verdict: "accurate",
    verdictReason: null,
    verdictAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "dec-2",
    taxpayerId: TAXPAYER_ID,
    year: TAX_YEAR,
    decisionKey: `decisions.trade.${aaplTrade.tradeId}.form_8949_box`,
    decision: "partII.boxD",
    rationale:
      "AAPL acquired 06/15/23, sold 09/15/25 — held > 1 year so long-term. Broker-reported as covered (basis reported) → Form 8949 Part II Box D.",
    supportingFactKeys: [makeTradeFactKey(ACCOUNT_SLUG, aaplTrade.tradeId)],
    confidence: "high",
    dissentingConsiderations: null,
    authorityCitations: null,
    sourceNote: null,
    createdAt: "2026-04-29T00:00:00Z",
    verdict: "accurate",
    verdictReason: null,
    verdictAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "dec-3",
    taxpayerId: TAXPAYER_ID,
    year: TAX_YEAR,
    decisionKey: `decisions.trade.${nvdaTrade.tradeId}.form_8949_box`,
    decision: "partI.boxA",
    rationale:
      "NVDA acquired 02/10/25, sold 11/20/25 — held < 1 year so short-term. Broker-reported as covered (basis reported) → Form 8949 Part I Box A.",
    supportingFactKeys: [makeTradeFactKey(ACCOUNT_SLUG, nvdaTrade.tradeId)],
    confidence: "high",
    dissentingConsiderations: null,
    authorityCitations: null,
    sourceNote: null,
    createdAt: "2026-04-29T00:00:00Z",
    verdict: "accurate",
    verdictReason: null,
    verdictAt: "2026-04-29T00:00:00Z",
  },
];

// ─── Run evaluator ───────────────────────────────────────────────────────

const ctx: DerivationContext = {
  taxYear: TAX_YEAR,
  facts: makeFactsView(facts),
  decisions: makeDecisionsView(decisions),
};

const result = evaluateForm8949(ctx);

// ─── Assertions ──────────────────────────────────────────────────────────

const failures: string[] = [];

const assert = (cond: boolean, label: string) => {
  if (!cond) failures.push(label);
};

const approx = (a: number, b: number, eps = 0.005) => Math.abs(a - b) < eps;

// must-file
assert(result.mustFile.ok === true, "mustFile evaluated successfully");
if (result.mustFile.ok) {
  assert(result.mustFile.value === true, "mustFile is true");
  assert(
    result.mustFile.decisionKey === "decisions.scope.has_reportable_sales",
    "mustFile traces back to scope decision",
  );
}

// 4 expected lines: Box A row 0, Box A totals, Box D row 0, Box D totals
assert(result.lines.length === 4, `expected 4 lines, got ${result.lines.length}`);

const findLine = (id: string) => result.lines.find((l) => l.lineId === id);

// Box A row (NVDA) — narrow on lineKind, no cast needed
const nvdaLine = findLine("form-8949.partI.boxA.rows.0");
assert(!!nvdaLine, "Box A row 0 exists (NVDA)");
if (nvdaLine?.lineKind === "form-8949.row" && nvdaLine.result.ok) {
  const row = nvdaLine.result.value;  // ← Form8949Row, fully typed
  assert(nvdaLine.box === "partI.boxA", "NVDA tagged as Box A");
  assert(nvdaLine.rowIndex === 0, "NVDA at row index 0");
  assert(row.description === "NVIDIA CORP", "NVDA description");
  assert(row.dateAcquired === "02/10/25", "NVDA date acquired");
  assert(row.dateSold === "11/20/25", "NVDA date sold");
  assert(approx(row.proceeds, 1650), "NVDA proceeds = 1650");
  assert(approx(row.costBasis, 1350), "NVDA cost basis = 1350");
  assert(approx(row.gainLoss, 300), "NVDA gain/loss = 300");
}

// Box A totals
const boxATotalsLine = findLine("form-8949.partI.boxA.totals");
assert(!!boxATotalsLine, "Box A totals line exists");
if (boxATotalsLine?.lineKind === "form-8949.totals" && boxATotalsLine.result.ok) {
  const totals = boxATotalsLine.result.value;  // ← Form8949BoxTotals
  assert(boxATotalsLine.box === "partI.boxA", "Totals tagged as Box A");
  assert(totals.rowCount === 1, "Box A row count = 1");
  assert(approx(totals.totalProceeds, 1650), "Box A total proceeds = 1650");
  assert(approx(totals.totalCostBasis, 1350), "Box A total basis = 1350");
  assert(approx(totals.totalGainLoss, 300), "Box A total gain = 300");
}

// Box D row (AAPL)
const aaplLine = findLine("form-8949.partII.boxD.rows.0");
assert(!!aaplLine, "Box D row 0 exists (AAPL)");
if (aaplLine?.lineKind === "form-8949.row" && aaplLine.result.ok) {
  const row = aaplLine.result.value;
  assert(aaplLine.box === "partII.boxD", "AAPL tagged as Box D");
  assert(row.description === "APPLE INC", "AAPL description");
  assert(approx(row.proceeds, 11500), "AAPL proceeds = 11500");
  assert(approx(row.costBasis, 9250), "AAPL cost basis = 9250");
  assert(approx(row.gainLoss, 2250), "AAPL gain/loss = 2250");
}

// Box D totals
const boxDTotalsLine = findLine("form-8949.partII.boxD.totals");
assert(!!boxDTotalsLine, "Box D totals line exists");
if (boxDTotalsLine?.lineKind === "form-8949.totals" && boxDTotalsLine.result.ok) {
  const totals = boxDTotalsLine.result.value;
  assert(boxDTotalsLine.box === "partII.boxD", "Totals tagged as Box D");
  assert(totals.rowCount === 1, "Box D row count = 1");
  assert(approx(totals.totalProceeds, 11500), "Box D total proceeds = 11500");
  assert(approx(totals.totalCostBasis, 9250), "Box D total basis = 9250");
  assert(approx(totals.totalGainLoss, 2250), "Box D total gain = 2250");
}

// Sanity: empty boxes should not appear
assert(!findLine("form-8949.partI.boxB.totals"), "Box B is empty / no line");
assert(!findLine("form-8949.partII.boxE.totals"), "Box E is empty / no line");

// ─── Report ──────────────────────────────────────────────────────────────

console.log(`\nForm 8949 evaluation: ${result.lines.length} lines\n`);
for (const line of result.lines) {
  if (line.result.ok) {
    const summary =
      typeof line.result.value === "object" && line.result.value !== null
        ? JSON.stringify(line.result.value)
        : String(line.result.value);
    console.log(`  ✓ ${line.lineId}`);
    console.log(`    ${summary}`);
  } else {
    console.log(`  ✗ ${line.lineId}: BLOCKED — ${line.result.reason}`);
  }
}

if (failures.length > 0) {
  console.log(`\n${failures.length} assertion(s) failed:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log("\nAll assertions passed.");
}
