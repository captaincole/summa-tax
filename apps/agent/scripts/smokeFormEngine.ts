// Smoke test for the form engine.
//
// Builds a minimal Alejandro-ish context (single filer, one W-2, one
// 1099-DIV), loads the form-1040 catalog from the JSON fixture, runs
// evaluateForm, and prints every field's result. Asserts a handful of
// known-good values that Phase F can flesh out into a real Mastra eval.
//
// Run: npx tsx scripts/smokeFormEngine.ts

import { resolve } from "node:path";
import "../src/mastra/forms/generated/form-1040.js";
import { evaluateForm } from "../src/mastra/forms/engine.js";
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

  const catalog = await loadFromFixtures([
    resolve(projectRoot, "fixtures/forms/form-1040-2025.json"),
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

  assertApprox("form-1040.line.1a", 100_000);
  assertApprox("form-1040.line.1z", 100_000);
  assertApprox("form-1040.line.3a", 381.4);
  assertApprox("form-1040.line.3b", 385.2);
  assertApprox("form-1040.line.7", 0); // Schedule D not yet wired in
  assertApprox("form-1040.line.9", 100_385.2);
  assertApprox("form-1040.line.11", 100_385.2);
  assertApprox("form-1040.line.12", 15_000);
  assertApprox("form-1040.line.14", 15_000);
  assertApprox("form-1040.line.15", 85_385.2);

  // 2025 single brackets on $85,385.20:
  //   10% on first 11,925         = 1,192.50
  //   12% on next  36,550         = 4,386.00
  //   22% on remaining 36,910.20  = 8,120.24
  const expectedTax = 1192.5 + 4386.0 + (85385.2 - 48475) * 0.22;
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
      console.log(`  ✓ ${field.fieldId.padEnd(34)} = ${pretty}`);
    } else {
      console.log(`  ✗ ${field.fieldId}: BLOCKED — ${field.result.reason}`);
    }
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} assertion(s) failed:`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(
    `\nAll ${form.fields.length} fields evaluated; ${form.fields.filter((f) => f.result.ok).length} ok.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
