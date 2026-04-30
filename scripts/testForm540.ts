// Smoke test for CA Form 540. Exercises the full four-form pipeline:
//   Form 8949 → Schedule D → Form 1040 → CA Form 540
// against Alejandro's fixture. Asserts CA-specific lines come out right
// and that the cross-form federal→state reference works.
//
// Run: npx tsx scripts/testForm540.ts

import { evaluateForm8949 } from "../src/mastra/forms/form8949.js";
import { evaluateScheduleD } from "../src/mastra/forms/scheduleD.js";
import { evaluateForm1040 } from "../src/mastra/forms/form1040.js";
import { evaluateForm540, type Form540LineNumber } from "../src/mastra/forms/form540.js";
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

// ─── Fixture (same as testForm1040) ──────────────────────────────────────

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
const w2: W2FactValue = {
  employerName: "Pacific Software, Inc.",
  employerEin: "47-8901234",
  box1: 100000.0, box2: 14500.0, box3: 100000.0, box4: 6200.0,
  box5: 100000.0, box6: 1450.0,
  box15: "CA", box16: 100000.0, box17: 5500.0,
};
const div: DividendFactValue = {
  payerName: "Apex Securities, Inc.",
  payerTin: "13-2345678",
  box1a: 385.20, box1b: 381.40,
};

const facts: TaxFactRow[] = [
  {
    id: "f-trade-aapl", taxpayerId: TAXPAYER_ID, year: TAX_YEAR,
    category: "investment_income", key: makeTradeFactKey(ACCOUNT_SLUG, aaplTrade.tradeId),
    value: aaplTrade, sourceNote: "Apex 1099-B LT Covered", createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-trade-nvda", taxpayerId: TAXPAYER_ID, year: TAX_YEAR,
    category: "investment_income", key: makeTradeFactKey(ACCOUNT_SLUG, nvdaTrade.tradeId),
    value: nvdaTrade, sourceNote: "Apex 1099-B ST Covered", createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-w2", taxpayerId: TAXPAYER_ID, year: TAX_YEAR,
    category: "wages", key: makeW2FactKey(EMPLOYER_SLUG),
    value: w2, sourceNote: "Pacific Software W-2", createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-div", taxpayerId: TAXPAYER_ID, year: TAX_YEAR,
    category: "investment_income", key: makeDividendFactKey(ACCOUNT_SLUG),
    value: div, sourceNote: "Apex 1099-DIV", createdAt: "2026-04-29T00:00:00Z",
  },
];

const dec = (
  key: string,
  decision: unknown,
  rationale: string,
  supportingFactKeys: string[] = [],
): AIDecisionRow => ({
  id: `dec-${key}`, taxpayerId: TAXPAYER_ID, year: TAX_YEAR,
  decisionKey: key, decision, rationale, supportingFactKeys,
  confidence: "high", dissentingConsiderations: null,
  authorityCitations: null, sourceNote: null,
  createdAt: "2026-04-29T00:00:00Z",
  verdict: "accurate", verdictReason: null, verdictAt: "2026-04-29T00:00:00Z",
});

const decisions: AIDecisionRow[] = [
  dec("decisions.scope.must_file_federal", true, "Income exceeds federal filing threshold."),
  dec("decisions.scope.must_file_ca_540", true,
    "Full-year CA resident with income above CA filing threshold."),
  dec("decisions.scope.filing_status", "single", "User stated single, no spouse, no dependents."),
  dec("decisions.scope.has_reportable_sales", true, "Apex 1099-B has two reportable sales."),
  dec(`decisions.trade.${aaplTrade.tradeId}.form_8949_box`, "partII.boxD",
    "AAPL >1yr held, basis reported."),
  dec(`decisions.trade.${nvdaTrade.tradeId}.form_8949_box`, "partI.boxA",
    "NVDA <1yr held, basis reported."),
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
const form540 = evaluateForm540(ctx, form1040);

// ─── Assertions ──────────────────────────────────────────────────────────

const failures: string[] = [];
const assert = (cond: boolean, label: string) => {
  if (!cond) failures.push(label);
};
const approx = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

assert(form540.mustFile.ok && form540.mustFile.value === true, "CA 540 mustFile = true");

const findLine = (n: Form540LineNumber) =>
  form540.lines.find((l) => l.lineNumber === n);
const valueOf = (n: Form540LineNumber): number | null => {
  const line = findLine(n);
  if (!line || !line.result.ok) return null;
  return line.result.value;
};

// Line 12 — CA wages from W-2 box 16
assert(approx(valueOf("12") ?? -1, 100000), "Line 12 (CA wages) = 100,000");

// Line 13 — Federal AGI from 1040 line 11
assert(approx(valueOf("13") ?? -1, 102935.20), "Line 13 (Federal AGI) = 102,935.20");

// Line 17 — CA AGI = Federal AGI (no Schedule CA adjustments)
assert(approx(valueOf("17") ?? -1, 102935.20), "Line 17 (CA AGI) = 102,935.20");

// Line 18 — CA standard deduction (single)
assert(approx(valueOf("18") ?? -1, 5540), "Line 18 (CA std ded single) = 5,540");

// Line 19 — Taxable income = 102,935.20 - 5,540 = 97,395.20
assert(approx(valueOf("19") ?? -1, 97395.20), "Line 19 (CA taxable) = 97,395.20");

// Line 31 — Tax. Compute expected from 2024 brackets:
const expectedTax =
  10_756 * 0.01 +
  (25_499 - 10_756) * 0.02 +
  (40_245 - 25_499) * 0.04 +
  (55_866 - 40_245) * 0.06 +
  (70_606 - 55_866) * 0.08 +
  (97_395.20 - 70_606) * 0.093;
assert(approx(valueOf("31") ?? -1, Math.round(expectedTax * 100) / 100),
  `Line 31 (CA tax) ≈ ${expectedTax.toFixed(2)}`);

// Line 64 — Total tax = line 31 (no exemption credits modeled yet)
assert(approx(valueOf("64") ?? -1, valueOf("31") ?? 0), "Line 64 (total tax) = line 31");

// Line 71 — CA withholding
assert(approx(valueOf("71") ?? -1, 5500), "Line 71 (CA withholding) = 5,500");

// Line 78 — Total payments = line 71 (no estimated payments)
assert(approx(valueOf("78") ?? -1, 5500), "Line 78 (total payments) = line 71");

// Refund (97) or owed (100)
const tax = valueOf("64") ?? 0;
const refund = 5500 - tax;
if (refund >= 0) {
  assert(approx(valueOf("97") ?? -1, refund), `Line 97 (overpaid) ≈ ${refund.toFixed(2)}`);
  assert(findLine("100") === undefined, "Line 100 not emitted when refund");
} else {
  assert(approx(valueOf("100") ?? -1, -refund), `Line 100 (tax due) ≈ ${(-refund).toFixed(2)}`);
  assert(findLine("97") === undefined, "Line 97 not emitted when balance due");
}

// ─── Report ──────────────────────────────────────────────────────────────

console.log(`\nCA Form 540 evaluation: ${form540.lines.length} lines`);
console.log(`  mustFile: ${form540.mustFile.ok ? form540.mustFile.value : "blocked"}\n`);

for (const line of form540.lines) {
  if (line.result.ok) {
    const v = line.result.value.toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    console.log(`  ✓ Line ${line.lineNumber.padEnd(4)} = ${v.padStart(14)}  (${line.label})`);
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
