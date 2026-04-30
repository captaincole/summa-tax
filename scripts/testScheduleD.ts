// Smoke test for Schedule D evaluator. Runs Form 8949 first (since Schedule
// D consumes its box totals) and then evaluates Schedule D. Asserts the
// expected lines + values for Alejandro's case (NVDA short-term + AAPL
// long-term, both covered).
//
// Run: npx tsx scripts/testScheduleD.ts

import { evaluateForm8949 } from "../src/mastra/forms/form8949.js";
import { evaluateScheduleD } from "../src/mastra/forms/scheduleD.js";
import {
  makeDecisionsView,
  makeFactsView,
  type DerivationContext,
} from "../src/mastra/forms/types.js";
import { makeTradeFactKey, type TradeFactValue } from "../src/mastra/facts/index.js";
import type { TaxFactRow } from "../src/mastra/db/taxFacts.js";
import type { AIDecisionRow } from "../src/mastra/db/aiDecisions.js";

const TAX_YEAR = 2025;
const TAXPAYER_ID = "alejandro-fixture";
const ACCOUNT_SLUG = "apex-individual";

// ─── Fixture (same as testForm8949) ──────────────────────────────────────

const aaplTrade: TradeFactValue = {
  tradeId: "aapl-2025-09-15",
  description: "APPLE INC",
  cusip: "037833100",
  symbol: "AAPL",
  quantity: 50,
  dateAcquired: "06/15/23",
  dateSold: "09/15/25",
  proceeds: 11500.0,
  costBasis: 9250.0,
};

const nvdaTrade: TradeFactValue = {
  tradeId: "nvda-2025-11-20",
  description: "NVIDIA CORP",
  cusip: "67066G104",
  symbol: "NVDA",
  quantity: 10,
  dateAcquired: "02/10/25",
  dateSold: "11/20/25",
  proceeds: 1650.0,
  costBasis: 1350.0,
};

const facts: TaxFactRow[] = [
  {
    id: "fact-1",
    taxpayerId: TAXPAYER_ID,
    year: TAX_YEAR,
    category: "investment_income",
    key: makeTradeFactKey(ACCOUNT_SLUG, aaplTrade.tradeId),
    value: aaplTrade,
    sourceNote: "Apex Securities consolidated 1099, 1099-B, Long Term Covered",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "fact-2",
    taxpayerId: TAXPAYER_ID,
    year: TAX_YEAR,
    category: "investment_income",
    key: makeTradeFactKey(ACCOUNT_SLUG, nvdaTrade.tradeId),
    value: nvdaTrade,
    sourceNote: "Apex Securities consolidated 1099, 1099-B, Short Term Covered",
    createdAt: "2026-04-29T00:00:00Z",
  },
];

const decisions: AIDecisionRow[] = [
  {
    id: "dec-1",
    taxpayerId: TAXPAYER_ID,
    year: TAX_YEAR,
    decisionKey: "decisions.scope.has_reportable_sales",
    decision: true,
    rationale: "Apex Securities 1099-B has two reportable sales (AAPL, NVDA).",
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
    rationale: "AAPL held > 1yr, basis reported (covered) → Form 8949 Part II Box D.",
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
    rationale: "NVDA held < 1yr, basis reported (covered) → Form 8949 Part I Box A.",
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

// ─── Run pipeline: Form 8949 → Schedule D ────────────────────────────────

const ctx: DerivationContext = {
  taxYear: TAX_YEAR,
  facts: makeFactsView(facts),
  decisions: makeDecisionsView(decisions),
};

const form8949 = evaluateForm8949(ctx);
const scheduleD = evaluateScheduleD(ctx, form8949);

// ─── Assertions ──────────────────────────────────────────────────────────

const failures: string[] = [];
const assert = (cond: boolean, label: string) => {
  if (!cond) failures.push(label);
};
const approx = (a: number, b: number, eps = 0.005) => Math.abs(a - b) < eps;

// Sanity: Form 8949 still works
assert(form8949.lines.length === 4, `Form 8949 has 4 lines, got ${form8949.lines.length}`);

// Schedule D mustFile
assert(scheduleD.mustFile.ok === true, "Schedule D mustFile evaluated");
if (scheduleD.mustFile.ok) {
  assert(scheduleD.mustFile.value === true, "Schedule D mustFile = true");
}

// 5 expected lines: 1a, 7, 8a, 15, 16
assert(scheduleD.lines.length === 5, `Schedule D has 5 lines, got ${scheduleD.lines.length}`);

const findLine = (number: string) =>
  scheduleD.lines.find((l) => l.lineNumber === number);

// Line 1a (short-term Box A aggregate)
const line1a = findLine("1a");
assert(!!line1a, "Schedule D line 1a exists");
if (line1a?.lineKind === "schedule-d.aggregate" && line1a.result.ok) {
  const v = line1a.result.value;
  assert(line1a.part === "I", "Line 1a is in Part I");
  assert(approx(v.proceeds, 1650), "Line 1a proceeds = 1650");
  assert(approx(v.costBasis, 1350), "Line 1a basis = 1350");
  assert(approx(v.gainLoss, 300), "Line 1a gain/loss = 300");
}

// Line 7 (net short-term)
const line7 = findLine("7");
assert(!!line7, "Schedule D line 7 exists");
if (line7?.lineKind === "schedule-d.single" && line7.result.ok) {
  assert(approx(line7.result.value, 300), "Line 7 = 300 (net short-term)");
}

// Line 8a (long-term Box D aggregate)
const line8a = findLine("8a");
assert(!!line8a, "Schedule D line 8a exists");
if (line8a?.lineKind === "schedule-d.aggregate" && line8a.result.ok) {
  const v = line8a.result.value;
  assert(line8a.part === "II", "Line 8a is in Part II");
  assert(approx(v.proceeds, 11500), "Line 8a proceeds = 11500");
  assert(approx(v.costBasis, 9250), "Line 8a basis = 9250");
  assert(approx(v.gainLoss, 2250), "Line 8a gain/loss = 2250");
}

// Line 15 (net long-term)
const line15 = findLine("15");
assert(!!line15, "Schedule D line 15 exists");
if (line15?.lineKind === "schedule-d.single" && line15.result.ok) {
  assert(approx(line15.result.value, 2250), "Line 15 = 2250 (net long-term)");
}

// Line 16 (combined — feeds 1040 line 7)
const line16 = findLine("16");
assert(!!line16, "Schedule D line 16 exists");
if (line16?.lineKind === "schedule-d.single" && line16.result.ok) {
  assert(line16.part === "III", "Line 16 is in Part III");
  assert(approx(line16.result.value, 2550), "Line 16 = 2550 (line 7 + line 15)");
}

// Audit trail check: line 16 should reference both trades' fact keys
if (line16?.result.ok) {
  const keys = line16.result.supportingFactKeys;
  assert(
    keys.includes(makeTradeFactKey(ACCOUNT_SLUG, aaplTrade.tradeId)) &&
      keys.includes(makeTradeFactKey(ACCOUNT_SLUG, nvdaTrade.tradeId)),
    "Line 16 audit trail traces back to both AAPL and NVDA fact keys",
  );
}

// ─── Report ──────────────────────────────────────────────────────────────

console.log(`\nSchedule D evaluation: ${scheduleD.lines.length} lines`);
console.log(`  mustFile: ${scheduleD.mustFile.ok ? scheduleD.mustFile.value : "blocked"}\n`);

for (const line of scheduleD.lines) {
  if (line.result.ok) {
    const summary =
      typeof line.result.value === "object"
        ? JSON.stringify(line.result.value)
        : String(line.result.value);
    console.log(`  ✓ Line ${line.lineNumber} (Part ${line.part}): ${summary}`);
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
