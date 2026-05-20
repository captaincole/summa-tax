// One-shot verification: prove EngineDerivation lands on EvaluatedForm and
// reports the correct path (explicit decision vs. data fallback) for the
// five must-file scope calls.
//
// Two passes over the Alejandro fixture:
//   1. WITH explicit must_file_* decisions → derivation reports the
//      explicit decision key.
//   2. WITH those decisions stripped (simulating the live Thom flow where
//      they aren't authored) → derivation reports the data-driven fallback
//      (trade facts present, or must_file_ca_540 = true).
//
//   npx tsx scripts/verifyMustFileDerivation.ts

import { registerAllForms, FORMS } from "../src/mastra/engine/registry.js";
import { evaluateAllForms } from "../src/mastra/engine/engine.js";
import { loadFromFixtures } from "../src/mastra/engine/catalog.js";
import { resolveFilingInfo } from "../src/mastra/engine/filingInfo.js";
import {
  makeDecisionsView,
  makeFactsView,
  type DerivationContext,
} from "../src/mastra/engine/types.js";
import { alejandroScenario } from "../tests/scenarios/alejandro/index.js";

registerAllForms();

const STRIP_KEYS = new Set([
  "decisions.scope.must_file_schedule_d",
  "decisions.scope.must_file_8949",
  "decisions.scope.must_file_schedule_ca",
]);

async function evaluateScenario(label: string, stripFormScope: boolean) {
  console.log(`\n══════ ${label} ══════`);
  const decisions = stripFormScope
    ? alejandroScenario.decisions.filter((d) => !STRIP_KEYS.has(d.decisionKey))
    : alejandroScenario.decisions;

  const filingInfo = resolveFilingInfo({
    facts: alejandroScenario.facts.map((f) => ({
      key: f.key,
      value: f.value,
      category: f.category,
    })),
    decisions: decisions.map((d) => ({
      decisionKey: d.decisionKey,
      decision: d.decision,
    })),
  });

  const ctx: DerivationContext = {
    taxYear: alejandroScenario.taxYear,
    facts: makeFactsView(alejandroScenario.facts),
    decisions: makeDecisionsView(decisions),
    filingInfo,
  };

  const catalog = await loadFromFixtures(FORMS.map((f) => f.catalogPath));
  const { forms } = evaluateAllForms(
    FORMS.map((f) => f.formId),
    ctx,
    catalog,
  );

  for (const formId of FORMS.map((f) => f.formId)) {
    const form = forms.get(formId)!;
    const must = form.mustFile.ok
      ? `${form.mustFile.value}`
      : `(blocked: ${form.mustFile.reason})`;
    const d = form.mustFileDerivation;
    console.log(`\n  ${formId}  mustFile=${must}`);
    if (d) {
      console.log(`    rule: ${d.rule}`);
      if (d.triggeredByFactKeys.length > 0) {
        console.log(`    factKeys: ${d.triggeredByFactKeys.join(", ")}`);
      }
      if (d.triggeredByDecisionKeys.length > 0) {
        console.log(`    decisionKeys: ${d.triggeredByDecisionKeys.join(", ")}`);
      }
    } else {
      console.log(`    (no derivation)`);
    }
  }
}

async function main() {
  await evaluateScenario("PASS 1 — with explicit must-file decisions", false);
  await evaluateScenario(
    "PASS 2 — must-file decisions stripped (live Thom flow)",
    true,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
