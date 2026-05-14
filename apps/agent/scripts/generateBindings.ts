// Phase D CLI — thin wrapper around the generateBindingsWorkflow.
//
//   npx tsx --env-file=.env.development scripts/generateBindings.ts \
//     --form-id=form-1040 \
//     --tax-year=2025
//
// Defaults:
//   --catalog defaults to forms/<jurisdiction>/<short>/catalog.json
//             (auto-discovered: federal/<short>, then state/ca/<short>, state/ny/<short>, …)
//   --output  derived from catalog location + formId:
//               federal  → src/mastra/engine/federal/<short>/bindings.ts
//               state/CA → src/mastra/engine/state/ca/<short>/bindings.ts
//             where <short> is the formId with "form-" stripped.
//
// Both can be overridden with --catalog=… and --output=… flags.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runGenerateBindings } from "../src/forms-pipeline/generateBindingsWorkflow/index.js";
import { projectRoot } from "../src/mastra/paths.js";

// Auto-discover the catalog file in the conventional locations. Each form
// has its own folder under forms/<jurisdiction>/<short>/ holding catalog.json.
// First match wins; pass --catalog to override. (taxYear is currently
// unused for path resolution — kept in the signature so the CLI's required
// --tax-year arg still drives the workflow even when not in the path.)
function findDefaultCatalog(formId: string, _taxYear: number): string {
  const shortName = formId.replace(/^form-/, "");
  const candidates = [
    `forms/federal/${shortName}/catalog.json`,
    `forms/state/ca/${shortName}/catalog.json`,
    `forms/state/ny/${shortName}/catalog.json`,
  ];
  for (const c of candidates) {
    const abs = resolve(projectRoot, c);
    if (existsSync(abs)) return abs;
  }
  // Fall back to the federal path; runGenerateBindings will fail with a
  // clear "file not found" error rather than swallowing the mismatch.
  return resolve(projectRoot, `forms/federal/${shortName}/catalog.json`);
}

interface Args {
  formId: string;
  taxYear: number;
  catalogPath: string;
  outputPath: string;
  minConfidence: "high" | "medium" | "low";
}

// Derive the bindings output path from the catalog path + formId.
// Catalog under forms/state/<state>/<short>/ → output under
// src/mastra/engine/state/<state>/<short>/bindings.ts. Federal catalog
// (forms/federal/<short>/) → src/mastra/engine/federal/<short>/bindings.ts.
function findDefaultOutput(formId: string, catalogPath: string): string {
  const shortName = formId.replace(/^form-/, "");
  const stateMatch = /\bforms\/state\/([a-z]+)\//.exec(catalogPath);
  if (stateMatch) {
    return resolve(
      projectRoot,
      `src/mastra/engine/state/${stateMatch[1]}/${shortName}/bindings.ts`,
    );
  }
  return resolve(
    projectRoot,
    `src/mastra/engine/federal/${shortName}/bindings.ts`,
  );
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const arg = argv.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.slice(flag.length + 1) : undefined;
  };
  const formId = get("--form-id");
  const taxYearStr = get("--tax-year");
  if (!formId || !taxYearStr) {
    throw new Error("Required: --form-id, --tax-year");
  }
  const taxYear = parseInt(taxYearStr, 10);
  const catalogOverride = get("--catalog");
  const catalogPath = catalogOverride
    ? resolve(catalogOverride)
    : findDefaultCatalog(formId, taxYear);
  const outputPath = resolve(
    get("--output") ?? findDefaultOutput(formId, catalogPath),
  );
  const minConfidenceRaw = get("--min-confidence") ?? "high";
  if (
    minConfidenceRaw !== "high" &&
    minConfidenceRaw !== "medium" &&
    minConfidenceRaw !== "low"
  ) {
    throw new Error(
      `--min-confidence must be one of: high, medium, low (got "${minConfidenceRaw}")`,
    );
  }
  return {
    formId,
    taxYear,
    catalogPath,
    outputPath,
    minConfidence: minConfidenceRaw,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`Phase D: generating bindings for ${args.formId} (${args.taxYear})`);
  console.log(`  Catalog:        ${args.catalogPath}`);
  console.log(`  Output:         ${args.outputPath}`);
  console.log(`  Min confidence: ${args.minConfidence}`);
  console.log();

  const result = await runGenerateBindings({
    formId: args.formId,
    taxYear: args.taxYear,
    catalogPath: args.catalogPath,
    outputPath: args.outputPath,
    minConfidence: args.minConfidence,
  });

  console.log();
  console.log(
    `  Fields: ${result.fieldCount}, emitted: ${result.emittedCount}, todos: ${result.todoCount}, unsupported: ${result.unsupportedCount}, unbound: ${result.unboundCount}`,
  );
  console.log(`  Retrieved IRS context for ${result.retrievalCount} field(s)`);
  console.log(
    `  Usage: in=${result.usage.input_tokens} out=${result.usage.output_tokens} cache_read=${result.usage.cache_read_input_tokens} cache_create=${result.usage.cache_creation_input_tokens}`,
  );
  console.log(`  Confidence breakdown:`);
  for (const level of ["high", "medium", "low"] as const) {
    console.log(`    ${level}: ${result.confidenceBreakdown[level] ?? 0}`);
  }
  console.log(`  Rule breakdown:`);
  const sorted = Object.entries(result.ruleBreakdown).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [rule, count] of sorted) {
    console.log(`    ${rule}: ${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
