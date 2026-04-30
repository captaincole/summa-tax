// Smoke test for Form 1040 when the taxpayer has no capital gains —
// validates that Schedule D is not required and line 7 falls through with
// a "Schedule D not required" rationale rather than a misleading "From
// Schedule D line 16."
//
// Models a stripped-down Alex-style fixture: single CA filer, one W-2,
// no investment account, no sales.
//
// Run: npx tsx scripts/testForm1040NoSales.ts

import { evaluateForm8949 } from "../src/mastra/forms/form8949.js";
import { evaluateScheduleD } from "../src/mastra/forms/scheduleD.js";
import { evaluateForm1040 } from "../src/mastra/forms/form1040.js";
import {
  makeDecisionsView,
  makeFactsView,
  type DerivationContext,
} from "../src/mastra/forms/types.js";
import { makeW2FactKey, type W2FactValue } from "../src/mastra/facts/index.js";
import type { TaxFactRow } from "../src/mastra/db/taxFacts.js";
import type { AIDecisionRow } from "../src/mastra/db/aiDecisions.js";

const TAX_YEAR = 2025;
const TAXPAYER_ID = "alex-fixture";
const EMPLOYER_SLUG = "brightside-logistics";

const w2: W2FactValue = {
  employerName: "Brightside Logistics, Inc.",
  employerEin: "36-1234567",
  box1: 79000.0,
  box2: 9420.0,
  box3: 85000.0,
  box4: 5270.0,
  box5: 85000.0,
  box6: 1232.5,
  box15: "CA",
  box16: 79000.0,
  box17: 3100.0,
};

const facts: TaxFactRow[] = [
  {
    id: "f-w2", taxpayerId: TAXPAYER_ID, year: TAX_YEAR,
    category: "wages", key: makeW2FactKey(EMPLOYER_SLUG),
    value: w2, sourceNote: "Brightside W-2", createdAt: "2026-04-29T00:00:00Z",
  },
];

const dec = (key: string, decision: unknown, rationale: string): AIDecisionRow => ({
  id: `dec-${key}`,
  taxpayerId: TAXPAYER_ID,
  year: TAX_YEAR,
  decisionKey: key,
  decision,
  rationale,
  supportingFactKeys: [],
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
  dec("decisions.scope.must_file_federal", true, "Income exceeds filing threshold."),
  dec("decisions.scope.filing_status", "single", "User stated single."),
  dec("decisions.scope.has_reportable_sales", false,
    "User stated no investment sales in 2025; no 1099-B received."),
];

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

// Form 8949 + Schedule D should NOT be required
assert(
  form8949.mustFile.ok && form8949.mustFile.value === false,
  "Form 8949 mustFile = false",
);
assert(form8949.lines.length === 0, "Form 8949 has zero lines (not required)");
assert(
  scheduleD.mustFile.ok && scheduleD.mustFile.value === false,
  "Schedule D mustFile = false",
);
assert(scheduleD.lines.length === 0, "Schedule D has zero lines (not required)");

// Form 1040 line 7 should be 0 with the right rationale
const line7 = form1040.lines.find((l) => l.lineNumber === "7");
assert(!!line7, "Form 1040 line 7 emitted");
if (line7?.result.ok) {
  assert(approx(line7.result.value, 0), "Line 7 = 0");
  assert(
    line7.result.rationale.startsWith("Schedule D not required"),
    `Line 7 rationale should cite Schedule D not required (got: "${line7.result.rationale}")`,
  );
}

// Refund computation should still work — Alex had $9,420 withheld vs
// taxable income of $79,000 - $15,000 = $64,000 → tax ≈ $9,253 → ~$167 refund
assert(approx(form1040.lines.find((l) => l.lineNumber === "1a")?.result.ok ? (form1040.lines.find((l) => l.lineNumber === "1a")!.result as { value: number }).value : -1, 79000), "Line 1a = 79,000");

const refundLine = form1040.lines.find((l) => l.lineNumber === "34");
const owedLine = form1040.lines.find((l) => l.lineNumber === "37");
assert(!!refundLine || !!owedLine, "Either line 34 or line 37 emitted");

// ─── Report ──────────────────────────────────────────────────────────────

console.log(`\nForm 1040 (no-sales case): ${form1040.lines.length} lines`);
console.log(`  form-8949 required: ${form8949.mustFile.ok ? form8949.mustFile.value : "?"}`);
console.log(`  schedule-d required: ${scheduleD.mustFile.ok ? scheduleD.mustFile.value : "?"}\n`);
for (const line of form1040.lines) {
  if (line.result.ok) {
    const v = line.result.value.toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    console.log(`  ✓ Line ${line.lineNumber.padEnd(4)} = ${v.padStart(14)}`);
    if (line.lineNumber === "7") {
      console.log(`    rationale: ${line.result.rationale}`);
    }
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
