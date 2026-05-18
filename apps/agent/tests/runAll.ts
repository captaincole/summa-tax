// Top-level test entry point — runs every registered scenario AND every
// listed catalog-fill check, printing one summary table. Designed for
// pre-commit hooks: fast, deterministic, offline, exits non-zero on any
// failure.
//
// Adding a new scenario: import its bundled Scenario and add to the
// SCENARIOS array below.
//
// Adding a new form's catalog-fill check: add its formId to
// CATALOG_FORM_IDS. The catalogFill harness resolves the catalog path by
// matching formId against catalog.json files under forms/; first run will
// fail with "no golden — run --update" so you can bootstrap the snapshot
// and commit it.

import { runScenario } from "./runScenario.js";
import type { RunResult, Scenario } from "./types.js";
import { alexScenario } from "./scenarios/alex/index.js";
import { runCatalogFillCheck } from "./catalogFill.js";

const SCENARIOS: Scenario[] = [
  alexScenario,
  // Future: bobScenario, carolScenario, …
];

// Forms whose catalogs we hold a fill-golden snapshot for. Explicit list
// over directory-walk discovery: failing to add a form here is a louder,
// more visible omission than failing to drop a file in the right place,
// and it survives refactors of the forms/ tree layout.
const CATALOG_FORM_IDS: string[] = [
  "form-1040",
  "form-540",
  "form-8949",
  "schedule-ca",
  "schedule-d",
];

async function main() {
  const totalChecks = SCENARIOS.length + CATALOG_FORM_IDS.length;
  const colWidth = Math.max(
    16,
    ...SCENARIOS.map((s) => s.name.length),
    ...CATALOG_FORM_IDS.map((id) => `catalog-fill:${id}`.length),
  );

  console.log(
    `Running ${SCENARIOS.length} scenario(s) + ${CATALOG_FORM_IDS.length} catalog-fill check(s)\n`,
  );
  const t0 = Date.now();
  const results: RunResult[] = [];

  const record = (r: RunResult) => {
    results.push(r);
    if (r.passed) {
      console.log(`✓ ${r.name.padEnd(colWidth)} ${r.durationMs}ms`);
    } else {
      console.error(
        `✗ ${r.name.padEnd(colWidth)} ${r.durationMs}ms — ${r.failures.length} failure(s):`,
      );
      for (const f of r.failures) console.error(`    ${f}`);
    }
  };

  // Catalog-fill checks run FIRST, before any scenario can install
  // per-field formatter overrides into the engine's global registry. The
  // overrides (e.g. SSN.format on 540 page 2) assume bare-digit input from
  // the production filingInfo path, not the harness's human-readable
  // synthetic — letting them run on the synthetic produces gibberish that
  // doesn't match the formatter-free golden. Keeping catalog-fill as a
  // pure catalog→widget check (no bindings registered) sidesteps the
  // problem and keeps the two test surfaces conceptually distinct.
  for (const id of CATALOG_FORM_IDS) record(await runCatalogFillCheck(id));
  for (const s of SCENARIOS) record(await runScenario(s));

  const totalMs = Date.now() - t0;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log("");
  console.log(
    `${passed}/${totalChecks} checks passed in ${totalMs}ms${failed > 0 ? ` — ${failed} FAILED` : ""}.`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[runAll] fatal:", err);
  process.exit(1);
});
