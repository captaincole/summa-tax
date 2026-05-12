// Top-level test entry point — runs every registered scenario and prints
// a summary table. Designed for pre-commit hooks: fast, deterministic,
// offline, exits non-zero on any failure.
//
// Adding a new scenario: import its bundled Scenario and add to the
// SCENARIOS array below.

import { runScenario } from "./runScenario.js";
import type { RunResult, Scenario } from "./types.js";
import { alexScenario } from "./scenarios/alex/index.js";

const SCENARIOS: Scenario[] = [
  alexScenario,
  // Future: bobScenario, carolScenario, …
];

async function main() {
  console.log(`Running ${SCENARIOS.length} scenario(s)\n`);
  const t0 = Date.now();
  const results: RunResult[] = [];
  for (const s of SCENARIOS) {
    const r = await runScenario(s);
    results.push(r);
    if (r.passed) {
      console.log(`✓ ${r.name.padEnd(12)} ${r.durationMs}ms`);
    } else {
      console.error(
        `✗ ${r.name.padEnd(12)} ${r.durationMs}ms — ${r.failures.length} failure(s):`,
      );
      for (const f of r.failures) console.error(`    ${f}`);
    }
  }

  const totalMs = Date.now() - t0;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log("");
  console.log(
    `${passed}/${results.length} scenarios passed in ${totalMs}ms${failed > 0 ? ` — ${failed} FAILED` : ""}.`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[runAll] fatal:", err);
  process.exit(1);
});
