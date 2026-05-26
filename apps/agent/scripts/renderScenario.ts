// Render every form in a scenario to disk for spot-checking.
//
//   npx tsx scripts/renderScenario.ts --scenario=alejandro
//
// Writes one PDF per form into the scenario's `docs/` folder using the
// pattern `<Scenario>-<FormShortName>-rendered.pdf`. Same engine +
// renderer the tests use, so the output reflects whatever state the
// bindings are in right now — including current failures.

import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { evaluateAllForms } from "../src/mastra/engine/engine.js";
import { loadFromFixtures } from "../src/mastra/engine/catalog.js";
import { getFormSpec } from "../src/mastra/engine/registry.js";
import { fillFromCatalog } from "../src/mastra/engine/render/fillFromCatalog.js";
import { resolveFilingInfo } from "../src/mastra/engine/filingInfo.js";
import {
  makeDecisionsView,
  makeFactsView,
  type DerivationContext,
} from "../src/mastra/engine/types.js";
import { projectRoot } from "../src/mastra/paths.js";
import type { Scenario } from "../tests/types.js";

// Pretty short-name fragment for filenames. Maps formId → the PascalCase
// chunk used in golden filenames (e.g. "form-540" → "CA540"). New forms
// fall back to a Title-case of the formId.
const FORM_SHORT_NAME: Record<string, string> = {
  "form-1040": "1040",
  "form-540": "CA540",
  "form-8949": "8949",
  "schedule-d": "ScheduleD",
  "schedule-ca": "ScheduleCA",
};
function shortName(formId: string): string {
  return FORM_SHORT_NAME[formId] ?? toPascal(formId);
}
function toPascal(s: string): string {
  return s
    .split(/[-_]/)
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : ""))
    .join("");
}

async function loadScenario(name: string): Promise<Scenario> {
  const mod = await import(`../tests/scenarios/${name}/index.js`);
  const candidates = [
    `${name}Scenario`,
    `${toPascal(name)}Scenario`,
    "default",
    "scenario",
  ];
  for (const key of candidates) {
    if (mod[key]) return mod[key] as Scenario;
  }
  throw new Error(
    `loadScenario("${name}"): no Scenario export found. Tried: ${candidates.join(", ")}`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: { scenario: { type: "string" } },
    strict: true,
  });
  const name = values.scenario;
  if (!name) {
    throw new Error("usage: tsx scripts/renderScenario.ts --scenario=<name>");
  }

  const s = await loadScenario(name);

  // Look up each scenario form's static config from the shared
  // registry (catalog/blank/register live there, not on ScenarioForm).
  const specs = s.forms.map((sf) => getFormSpec(sf.formId));

  // Register every form's bindings before evaluation. Side-effecting
  // calls match what runScenario does.
  for (const spec of specs) spec.register?.();

  const ctx: DerivationContext = {
    taxYear: s.taxYear,
    facts: makeFactsView(s.facts),
    decisions: makeDecisionsView(s.decisions),
    filingInfo: resolveFilingInfo({
      facts: s.facts.map((f) => ({
        key: f.key,
        value: f.value,
        category: f.category,
      })),
      decisions: s.decisions.map((d) => ({
        decisionKey: d.decisionKey,
        decision: d.decision,
      })),
    }),
  };

  const catalog = await loadFromFixtures(specs.map((spec) => spec.catalogPath));

  const { forms, passes } = evaluateAllForms(
    s.forms.map((f) => f.formId),
    ctx,
    catalog,
  );

  console.log(
    `Rendering ${s.forms.length} form(s) for scenario "${s.name}" (engine converged in ${passes} pass${passes === 1 ? "" : "es"}):\n`,
  );

  const docsDir = resolve(
    projectRoot,
    `tests/scenarios/${name}/docs`,
  );

  for (const spec of specs) {
    const evaluated = forms.get(spec.formId);
    if (!evaluated) {
      console.log(`  ✗ ${spec.formId} — no evaluation result`);
      continue;
    }

    const blankBytes = await readFile(spec.blankPdfPath);
    const { pdfBytes, warnings } = await fillFromCatalog({
      blankPdfBytes: blankBytes,
      form: evaluated,
      catalog,
    });

    const outName = `${toPascal(s.name)}-${shortName(spec.formId)}-rendered.pdf`;
    const outPath = resolve(docsDir, outName);
    await writeFile(outPath, pdfBytes);

    const filled = evaluated.fields.filter((f) => f.result.ok).length;
    const total = evaluated.fields.length;
    console.log(
      `  ✓ ${spec.formId.padEnd(14)} → ${outName}  (${filled}/${total} fields filled${warnings.length ? `, ${warnings.length} warning(s)` : ""})`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
