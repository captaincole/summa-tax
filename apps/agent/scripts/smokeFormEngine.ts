// Smoke test for the form engine.
//
// Builds a minimal Alejandro-ish context (single filer, one W-2, one
// 1099-DIV), loads the form-1040 catalog from the JSON fixture, runs
// evaluateForm, and prints every field's result. Asserts a handful of
// known-good values that Phase F can flesh out into a real Mastra eval.
//
// Run: npx tsx scripts/smokeFormEngine.ts

import { resolve } from "node:path";
import { register as registerForm1040 } from "../src/mastra/forms/generated/form-1040.js";
import { evaluateForm } from "../src/mastra/forms/engine.js";

registerForm1040();
import { loadFromFixtures } from "../src/mastra/forms/catalog.js";
import { projectRoot } from "../src/mastra/paths.js";
import {
  makeDecisionsView,
  makeFactsView,
  type DerivationContext,
} from "../src/mastra/forms/types.js";
import {
  makeDividendFactKey,
  makeW2FactKey,
  type DividendFactValue,
  type W2FactValue,
} from "../src/mastra/facts/index.js";
import type { TaxFactRow } from "../src/mastra/db/taxFacts.js";
import type { AIDecisionRow } from "../src/mastra/db/aiDecisions.js";

const YEAR = 2025;
const TAXPAYER = "alejandro-phaseA";

const w2: W2FactValue = {
  employerName: "Pacific Software, Inc.",
  employerEin: "47-8901234",
  box1: 100_000,
  box2: 14_500,
};

const div: DividendFactValue = {
  payerName: "Apex Securities, Inc.",
  box1a: 385.2,
  box1b: 381.4,
};

const facts: TaxFactRow[] = [
  {
    id: "f-id-first",
    taxpayerId: TAXPAYER,
    year: YEAR,
    category: "identity",
    key: "identity.name.first",
    value: "Alejandro",
    sourceNote: "verbal",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-id-last",
    taxpayerId: TAXPAYER,
    year: YEAR,
    category: "identity",
    key: "identity.name.last",
    value: "Vasquez",
    sourceNote: "verbal",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-id-ssn",
    taxpayerId: TAXPAYER,
    year: YEAR,
    category: "identity",
    key: "identity.ssn",
    value: "123-45-6789",
    sourceNote: "verbal",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-id-addr",
    taxpayerId: TAXPAYER,
    year: YEAR,
    category: "identity",
    key: "identity.address",
    value: { line1: "123 Main St", city: "San Francisco", state: "CA", zip: "94110" },
    sourceNote: "verbal",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-w2",
    taxpayerId: TAXPAYER,
    year: YEAR,
    category: "wages",
    key: makeW2FactKey("pacific-software"),
    value: w2,
    sourceNote: "W-2 from Pacific Software",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-div",
    taxpayerId: TAXPAYER,
    year: YEAR,
    category: "investment_income",
    key: makeDividendFactKey("apex-individual"),
    value: div,
    sourceNote: "Apex 1099-DIV",
    createdAt: "2026-04-29T00:00:00Z",
  },
];

const dec = (
  key: string,
  decision: unknown,
  rationale: string,
  supportingFactKeys: string[] = [],
): AIDecisionRow => ({
  id: `dec-${key}`,
  taxpayerId: TAXPAYER,
  year: YEAR,
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
  dec(
    "decisions.scope.must_file_federal",
    true,
    "Single filer with AGI > standard deduction threshold.",
    [makeW2FactKey("pacific-software")],
  ),
  dec("decisions.scope.filing_status", "single", "User stated single."),
];

async function main() {
  const ctx: DerivationContext = {
    taxYear: YEAR,
    facts: makeFactsView(facts),
    decisions: makeDecisionsView(decisions),
  };

  // Phase D catalog: the AI-extracted form-1040 fields, 197 entries.
  // Pairs with the AI-generated bindings in forms/generated/form-1040.ts.
  const catalog = await loadFromFixtures([
    resolve(projectRoot, "fixtures/forms/form-1040-2025.extracted.json"),
  ]);

  const form = evaluateForm("form-1040", ctx, catalog);

  console.log(`\nform-1040 — ${form.title} (${form.taxYear})`);
  console.log(
    `mustFile: ${form.mustFile.ok ? form.mustFile.value : `BLOCKED — ${form.mustFile.reason}`}\n`,
  );

  const failures: string[] = [];
  const approx = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;
  const valueOf = (fieldId: string): unknown => {
    const f = form.fields.find((x) => x.fieldId === fieldId);
    if (!f || !f.result.ok) return undefined;
    return f.result.value;
  };
  const assertApprox = (fieldId: string, expected: number) => {
    const v = valueOf(fieldId);
    if (typeof v !== "number" || !approx(v, expected)) {
      failures.push(`${fieldId}: expected ≈ ${expected}, got ${String(v)}`);
    }
  };

  // The AI's bindings use slightly different fieldIds than the hand-written
  // fixture — line 11 splits into 11a/11b (one per page), line 12 splits
  // into 12a–12e (with 12e being the actual standard deduction amount).
  // Standard deduction value is also higher than the hand-written 15000
  // because the AI picked up the 2025 OBBBA update (15750 for single).

  assertApprox("form-1040.line.1a", 100_000);
  assertApprox("form-1040.line.1z", 100_000);
  assertApprox("form-1040.line.3a", 381.4);
  assertApprox("form-1040.line.3b", 385.2);
  assertApprox("form-1040.line.9", 100_385.2);
  assertApprox("form-1040.line.11a", 100_385.2); // AGI (page 1 display)
  assertApprox("form-1040.line.11b", 100_385.2); // AGI (page 2 display)
  assertApprox("form-1040.line.12e", 15_750);    // Standard deduction (2025 OBBBA)
  assertApprox("form-1040.line.14", 15_750);
  assertApprox("form-1040.line.15", 84_635.2);   // Taxable income

  // 2025 single brackets on $84,635.20:
  //   10% on first 11,925         = 1,192.50
  //   12% on next  36,550         = 4,386.00
  //   22% on remaining 36,160.20  = 7,955.24
  const expectedTax = 1192.5 + 4386.0 + (84635.2 - 48475) * 0.22;
  assertApprox("form-1040.line.16", expectedTax);
  assertApprox("form-1040.line.24", expectedTax);
  assertApprox("form-1040.line.25a", 14_500);
  assertApprox("form-1040.line.33", 14_500);

  const expectedRefund = 14_500 - expectedTax;
  if (expectedRefund > 0) {
    assertApprox("form-1040.line.34", expectedRefund);
    assertApprox("form-1040.line.37", 0);
  } else {
    assertApprox("form-1040.line.34", 0);
    assertApprox("form-1040.line.37", -expectedRefund);
  }

  // Print every field's result. Three states:
  //   ✓ ok           — engine computed a value
  //   ⊘ unsupported  — engine gap (no scenario / no ingestion); doesn't block Thom
  //   ✗ blocked      — actual missing input (user fact or decision needed)
  for (const field of form.fields) {
    if (field.result.ok) {
      const v = field.result.value;
      const pretty =
        typeof v === "number"
          ? v.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
          : typeof v === "string"
            ? v
            : JSON.stringify(v);
      console.log(`  ✓ ${field.fieldId.padEnd(50)} = ${pretty}`);
    } else if (field.result.unsupported) {
      console.log(`  ⊘ ${field.fieldId.padEnd(50)} — ${field.result.reason}`);
    } else {
      console.log(`  ✗ ${field.fieldId}: BLOCKED — ${field.result.reason}`);
    }
  }

  const okCount = form.fields.filter((f) => f.result.ok).length;
  const unsupportedCount = form.fields.filter(
    (f) => !f.result.ok && f.result.unsupported,
  ).length;
  const blockedCount = form.fields.length - okCount - unsupportedCount;
  console.log();
  console.log(
    `Summary: ${form.fields.length} fields — ${okCount} ok, ${blockedCount} blocked, ${unsupportedCount} unsupported.`,
  );

  if (failures.length > 0) {
    console.log(`\n${failures.length} assertion(s) failed:`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`All assertions passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
