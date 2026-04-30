// Smoke-render the Form 8949 + Schedule D PDFs from Alejandro's fixture
// data and write them to disk for manual inspection. Doesn't run the full
// generate-draft-1040 tool path (skips DB) — just exercises the renderers
// end-to-end against the form-engine output.
//
// Run: npx tsx scripts/testRenderForms.ts
// Then open: src/mastra/public/drafts/test-8949.pdf
//            src/mastra/public/drafts/test-schedule-d.pdf

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateForm8949 } from "../src/mastra/forms/form8949.js";
import { evaluateScheduleD } from "../src/mastra/forms/scheduleD.js";
import { evaluateForm1040 } from "../src/mastra/forms/form1040.js";
import { evaluateForm540 } from "../src/mastra/forms/form540.js";
import { renderForm8949Pdf } from "../src/mastra/forms/render/form8949Pdf.js";
import { renderScheduleDPdf } from "../src/mastra/forms/render/scheduleDPdf.js";
import { renderForm540Pdf } from "../src/mastra/forms/render/form540Pdf.js";
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
const OUTPUT_DIR = resolve(process.cwd(), "src/mastra/public/drafts");

const aaplTrade: TradeFactValue = {
  tradeId: "aapl-2025-09-15",
  description: "APPLE INC", cusip: "037833100", symbol: "AAPL",
  quantity: 50, dateAcquired: "06/15/23", dateSold: "09/15/25",
  proceeds: 11500, costBasis: 9250,
};
const nvdaTrade: TradeFactValue = {
  tradeId: "nvda-2025-11-20",
  description: "NVIDIA CORP", cusip: "67066G104", symbol: "NVDA",
  quantity: 10, dateAcquired: "02/10/25", dateSold: "11/20/25",
  proceeds: 1650, costBasis: 1350,
};

const w2: W2FactValue = {
  employerName: "Pacific Software, Inc.",
  employerEin: "47-8901234",
  box1: 100000, box2: 14500, box3: 100000, box4: 6200,
  box5: 100000, box6: 1450, box15: "CA", box16: 100000, box17: 5500,
};
const div: DividendFactValue = {
  payerName: "Apex Securities, Inc.", payerTin: "13-2345678",
  box1a: 385.20, box1b: 381.40,
};

const facts: TaxFactRow[] = [
  { id: "1", taxpayerId: TAXPAYER_ID, year: TAX_YEAR, category: "investment_income",
    key: makeTradeFactKey(ACCOUNT_SLUG, aaplTrade.tradeId), value: aaplTrade,
    sourceNote: "fixture", createdAt: "2026-04-30T00:00:00Z" },
  { id: "2", taxpayerId: TAXPAYER_ID, year: TAX_YEAR, category: "investment_income",
    key: makeTradeFactKey(ACCOUNT_SLUG, nvdaTrade.tradeId), value: nvdaTrade,
    sourceNote: "fixture", createdAt: "2026-04-30T00:00:00Z" },
  { id: "3", taxpayerId: TAXPAYER_ID, year: TAX_YEAR, category: "wages",
    key: makeW2FactKey(EMPLOYER_SLUG), value: w2,
    sourceNote: "fixture", createdAt: "2026-04-30T00:00:00Z" },
  { id: "4", taxpayerId: TAXPAYER_ID, year: TAX_YEAR, category: "investment_income",
    key: makeDividendFactKey(ACCOUNT_SLUG), value: div,
    sourceNote: "fixture", createdAt: "2026-04-30T00:00:00Z" },
];

const dec = (key: string, decision: unknown, rationale: string): AIDecisionRow => ({
  id: `dec-${key}`, taxpayerId: TAXPAYER_ID, year: TAX_YEAR,
  decisionKey: key, decision, rationale, supportingFactKeys: [],
  confidence: "high", dissentingConsiderations: null,
  authorityCitations: null, sourceNote: null,
  createdAt: "2026-04-30T00:00:00Z",
  verdict: "accurate", verdictReason: null, verdictAt: "2026-04-30T00:00:00Z",
});

const decisions: AIDecisionRow[] = [
  dec("decisions.scope.must_file_federal", true, "Income above threshold"),
  dec("decisions.scope.must_file_ca_540", true, "Full-year CA resident"),
  dec("decisions.scope.filing_status", "single", "User stated single"),
  dec("decisions.scope.has_reportable_sales", true, "Two reportable sales"),
  dec(`decisions.trade.${aaplTrade.tradeId}.form_8949_box`, "partII.boxD", "AAPL LT covered"),
  dec(`decisions.trade.${nvdaTrade.tradeId}.form_8949_box`, "partI.boxA", "NVDA ST covered"),
];

const ctx: DerivationContext = {
  taxYear: TAX_YEAR,
  facts: makeFactsView(facts),
  decisions: makeDecisionsView(decisions),
};

const form8949 = evaluateForm8949(ctx);
const scheduleD = evaluateScheduleD(ctx, form8949);
const form1040 = evaluateForm1040(ctx, scheduleD);
const form540 = evaluateForm540(ctx, form1040);

async function main() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

  // ─── Form 8949 ───
  const blank8949 = readFileSync(resolve(process.cwd(), "ref/forms/f8949.pdf"));
  const r8949 = await renderForm8949Pdf({
    templateBytes: blank8949,
    evaluated: form8949,
    taxpayerName: "Alejandro Reyes",
    taxpayerSsn: "234-56-7890",
  });
  const out8949 = resolve(OUTPUT_DIR, "test-8949.pdf");
  writeFileSync(out8949, r8949.bytes);
  console.log(`✓ Form 8949: ${out8949} (${r8949.linesPopulated} lines populated)`);

  // ─── Schedule D ───
  const blankSd = readFileSync(resolve(process.cwd(), "ref/forms/f1040sd.pdf"));
  const rSd = await renderScheduleDPdf({
    templateBytes: blankSd,
    evaluated: scheduleD,
    taxpayerName: "Alejandro Reyes",
    taxpayerSsn: "234-56-7890",
  });
  const outSd = resolve(OUTPUT_DIR, "test-schedule-d.pdf");
  writeFileSync(outSd, rSd.bytes);
  console.log(`✓ Schedule D: ${outSd} (${rSd.linesPopulated} lines populated)`);

  // ─── CA Form 540 ───
  const blank540 = readFileSync(resolve(process.cwd(), "ref/forms/state/ca/2025-540.pdf"));
  const r540 = await renderForm540Pdf({
    templateBytes: blank540,
    evaluated: form540,
    taxpayerFirstName: "Alejandro",
    taxpayerLastName: "Reyes",
    taxpayerSsn: "234-56-7890",
    taxpayerDob: "03/14/1991",
    taxpayerStreetAddress: "123 Valencia Street",
    taxpayerCity: "San Francisco",
    taxpayerZip: "94110",
    filingStatus: "single",
  });
  const out540 = resolve(OUTPUT_DIR, "test-540.pdf");
  writeFileSync(out540, r540.bytes);
  console.log(`✓ CA Form 540: ${out540} (${r540.linesPopulated} lines populated)`);

  console.log("\nOpen each PDF and verify:");
  console.log("  Form 8949 Page 1: Box A checked, NVDA row populated, $1,650/$1,350/$300 in totals");
  console.log("  Form 8949 Page 2: Box D checked, AAPL row populated, $11,500/$9,250/$2,250 in totals");
  console.log("  Schedule D: Line 1a $1,650/$1,350/$300, Line 7 = $300, Line 8a $11,500/$9,250/$2,250, Line 15 = $2,250, Line 16 = $2,550");
  console.log("  CA 540: Single checked, Line 12=$100,000, Line 13=$102,935, Line 17=$102,935, Line 18=$5,540, Line 19=$97,395, Line 31≈$5,600, Line 71=$5,500, Line 100=$100");
}

main().catch((err) => { console.error(err); process.exit(1); });
