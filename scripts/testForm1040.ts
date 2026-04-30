// Smoke test for Form 1040 evaluator. Runs the full pipeline:
//   Form 8949 → Schedule D → Form 1040
// against Alejandro's fixture. Asserts expected line values and the
// refund/owed direction.
//
// Run: npx tsx scripts/testForm1040.ts

import { evaluateForm8949 } from "../src/mastra/forms/form8949.js";
import { evaluateScheduleD } from "../src/mastra/forms/scheduleD.js";
import { evaluateForm1040, type Form1040LineNumber } from "../src/mastra/forms/form1040.js";
import {
  makeDecisionsView,
  makeFactsView,
  type DerivationContext,
} from "../src/mastra/forms/types.js";
import {
  makeDividendFactKey,
  makeTradeFactKey,
  makeW2FactKey,
  type DividendFactValue,
  type TradeFactValue,
  type W2FactValue,
} from "../src/mastra/facts/index.js";
import type { TaxFactRow } from "../src/mastra/db/taxFacts.js";
import type { AIDecisionRow } from "../src/mastra/db/aiDecisions.js";

const TAX_YEAR = 2025;
const TAXPAYER_ID = "alejandro-fixture";
const ACCOUNT_SLUG = "apex-individual";
const EMPLOYER_SLUG = "pacific-software";

// ─── Fixture: facts ──────────────────────────────────────────────────────

const aaplTrade: TradeFactValue = {
  tradeId: "aapl-2025-09-15",
  description: "APPLE INC", cusip: "037833100", symbol: "AAPL",
  quantity: 50, dateAcquired: "06/15/23", dateSold: "09/15/25",
  proceeds: 11500.0, costBasis: 9250.0,
};
const nvdaTrade: TradeFactValue = {
  tradeId: "nvda-2025-11-20",
  description: "NVIDIA CORP", cusip: "67066G104", symbol: "NVDA",
  quantity: 10, dateAcquired: "02/10/25", dateSold: "11/20/25",
  proceeds: 1650.0, costBasis: 1350.0,
};

// W-2 from Pacific Software, $100k box 1, $14,500 box 2.
const w2: W2FactValue = {
  employerName: "Pacific Software, Inc.",
  employerEin: "47-8901234",
  employerAddress: { line1: "600 Townsend Street", city: "San Francisco", state: "CA", zip: "94103" },
  box1: 100000.0,
  box2: 14500.0,
  box3: 100000.0,
  box4: 6200.0,
  box5: 100000.0,
  box6: 1450.0,
  box15: "CA",
  box16: 100000.0,
  box17: 5500.0,
};

// 1099-DIV summary from Apex
const div: DividendFactValue = {
  payerName: "Apex Securities, Inc.",
  payerTin: "13-2345678",
  box1a: 385.20,
  box1b: 381.40,
};

const facts: TaxFactRow[] = [
  // Trades
  {
    id: "f-trade-aapl", taxpayerId: TAXPAYER_ID, year: TAX_YEAR,
    category: "investment_income", key: makeTradeFactKey(ACCOUNT_SLUG, aaplTrade.tradeId),
    value: aaplTrade, sourceNote: "Apex 1099-B, LT Covered", createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-trade-nvda", taxpayerId: TAXPAYER_ID, year: TAX_YEAR,
    category: "investment_income", key: makeTradeFactKey(ACCOUNT_SLUG, nvdaTrade.tradeId),
    value: nvdaTrade, sourceNote: "Apex 1099-B, ST Covered", createdAt: "2026-04-29T00:00:00Z",
  },
  // W-2
  {
    id: "f-w2", taxpayerId: TAXPAYER_ID, year: TAX_YEAR,
    category: "wages", key: makeW2FactKey(EMPLOYER_SLUG),
    value: w2, sourceNote: "Pacific Software W-2", createdAt: "2026-04-29T00:00:00Z",
  },
  // 1099-DIV summary
  {
    id: "f-div", taxpayerId: TAXPAYER_ID, year: TAX_YEAR,
    category: "investment_income", key: makeDividendFactKey(ACCOUNT_SLUG),
    value: div, sourceNote: "Apex 1099-DIV", createdAt: "2026-04-29T00:00:00Z",
  },
];

// ─── Fixture: decisions ──────────────────────────────────────────────────

const dec = (
  key: string,
  decision: unknown,
  rationale: string,
  supportingFactKeys: string[] = [],
): AIDecisionRow => ({
  id: `dec-${key}`,
  taxpayerId: TAXPAYER_ID,
  year: TAX_YEAR,
  decisionKey: key,
  decision,
  rationale,
  supportingFactKeys,
  confidence: "high",
  dissentingConsiderations: null,
  authorityCitations: null,
  sourceNote: null,
  createdAt: "2026-04-29T00:00:00Z",
  verdict: "accurate",
  verdictReason: null,
  verdictAt: "2026-04-29T00:00:00Z",
});

const decisions: AIDecisionRow[] = [
  dec("decisions.scope.must_file_federal", true,
    "Federal filing required: AGI exceeds the single filer threshold.",
    [makeW2FactKey(EMPLOYER_SLUG)]),
  dec("decisions.scope.filing_status", "single",
    "User stated single, no spouse, no dependents.", []),
  dec("decisions.scope.has_reportable_sales", true,
    "Apex 1099-B has two reportable sales.",
    [makeTradeFactKey(ACCOUNT_SLUG, aaplTrade.tradeId), makeTradeFactKey(ACCOUNT_SLUG, nvdaTrade.tradeId)]),
  dec(`decisions.trade.${aaplTrade.tradeId}.form_8949_box`, "partII.boxD",
    "AAPL held >1yr, basis reported.", [makeTradeFactKey(ACCOUNT_SLUG, aaplTrade.tradeId)]),
  dec(`decisions.trade.${nvdaTrade.tradeId}.form_8949_box`, "partI.boxA",
    "NVDA held <1yr, basis reported.", [makeTradeFactKey(ACCOUNT_SLUG, nvdaTrade.tradeId)]),
];

// ─── Run pipeline ────────────────────────────────────────────────────────

const ctx: DerivationContext = {
  taxYear: TAX_YEAR,
  facts: makeFactsView(facts),
  decisions: makeDecisionsView(decisions),
};

const form8949 = evaluateForm8949(ctx);
const scheduleD = evaluateScheduleD(ctx, form8949);
const form1040 = evaluateForm1040(ctx, scheduleD);

// ─── Assertions ──────────────────────────────────────────────────────────

const failures: string[] = [];
const assert = (cond: boolean, label: string) => {
  if (!cond) failures.push(label);
};
const approx = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

assert(form1040.mustFile.ok === true && form1040.mustFile.ok && form1040.mustFile.value === true,
  "Form 1040 mustFile = true");

const findLine = (n: Form1040LineNumber) =>
  form1040.lines.find((l) => l.lineNumber === n);

const valueOf = (n: Form1040LineNumber): number | null => {
  const line = findLine(n);
  if (!line || !line.result.ok) return null;
  return line.result.value;
};

// Income-side
assert(approx(valueOf("1a") ?? -1, 100000), "Line 1a (wages) = 100,000");
assert(approx(valueOf("1z") ?? -1, 100000), "Line 1z (sum 1a-1h) = 100,000");
assert(approx(valueOf("3a") ?? -1, 381.40), "Line 3a (qual divs) = 381.40");
assert(approx(valueOf("3b") ?? -1, 385.20), "Line 3b (ord divs) = 385.20");
assert(approx(valueOf("7") ?? -1, 2550), "Line 7 (cap gain from Schedule D line 16) = 2,550");
assert(approx(valueOf("9") ?? -1, 102935.20), "Line 9 (total income) = 102,935.20");
assert(approx(valueOf("10") ?? -1, 0), "Line 10 (adjustments) = 0");
assert(approx(valueOf("11") ?? -1, 102935.20), "Line 11 (AGI) = 102,935.20");

// Deduction-side
assert(approx(valueOf("12") ?? -1, 15000), "Line 12 (std deduction single) = 15,000");
assert(approx(valueOf("13") ?? -1, 0), "Line 13 (QBI) = 0");
assert(approx(valueOf("14") ?? -1, 15000), "Line 14 (12+13) = 15,000");
assert(approx(valueOf("15") ?? -1, 87935.20), "Line 15 (taxable income) = 87,935.20");

// Tax (ordinary brackets only — known simplification)
// Expected tax ≈ $14,259.74 on $87,935.20 taxable income for 2025 single
const expectedTax = 1192.5 + (48475 - 11925) * 0.12 + (87935.20 - 48475) * 0.22;
assert(approx(valueOf("16") ?? -1, expectedTax),
  `Line 16 (tax via ordinary brackets) ≈ ${expectedTax.toFixed(2)}`);
assert(approx(valueOf("23") ?? -1, 0), "Line 23 (other taxes) = 0");
assert(approx(valueOf("24") ?? -1, expectedTax), "Line 24 (total tax) = line 16");

// Payments + refund
assert(approx(valueOf("25a") ?? -1, 14500), "Line 25a (W-2 box 2 sum) = 14,500");
assert(approx(valueOf("33") ?? -1, 14500), "Line 33 (total payments) = 14,500");

// Refund vs owed
const expectedRefund = 14500 - expectedTax;
const expectedOwed = expectedTax - 14500;
if (expectedRefund > 0) {
  assert(approx(valueOf("34") ?? -1, expectedRefund),
    `Line 34 (refund) ≈ ${expectedRefund.toFixed(2)}`);
  assert(findLine("37") === undefined, "Line 37 not emitted when refund");
} else {
  assert(approx(valueOf("37") ?? -1, expectedOwed),
    `Line 37 (owed) ≈ ${expectedOwed.toFixed(2)}`);
  assert(findLine("34") === undefined, "Line 34 not emitted when balance due");
}

// ─── Report ──────────────────────────────────────────────────────────────

console.log(`\nForm 1040 evaluation: ${form1040.lines.length} lines`);
console.log(`  mustFile: ${form1040.mustFile.ok ? form1040.mustFile.value : "blocked"}\n`);

for (const line of form1040.lines) {
  if (line.result.ok) {
    const v = line.result.value;
    const pretty = typeof v === "number" ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
    console.log(`  ✓ Line ${line.lineNumber.padEnd(4)} = ${pretty.padStart(14)}  (${line.label})`);
  } else {
    console.log(`  ✗ Line ${line.lineNumber}: BLOCKED — ${line.result.reason}`);
  }
}

if (failures.length > 0) {
  console.log(`\n${failures.length} assertion(s) failed:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log("\nAll assertions passed.");
}
