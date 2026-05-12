// Single-scenario entry point — runs just Alex. Useful for iterating on
// Alex's facts/decisions/expected without running every other scenario.
//
// Run: npm run test:alex

import { runScenario } from "../../runScenario.js";
import { alexScenario } from "./index.js";

async function main() {
  const r = await runScenario(alexScenario);
  if (r.passed) {
    console.log(`✓ ${r.name}: all assertions passed in ${r.durationMs}ms`);
    process.exit(0);
  }
  console.error(
    `✗ ${r.name}: ${r.failures.length} failure(s) in ${r.durationMs}ms:`,
  );
  for (const f of r.failures) console.error(`  ${f}`);
  process.exit(1);
}

main().catch((err) => {
  console.error("[test:alex] fatal:", err);
  process.exit(1);
});
