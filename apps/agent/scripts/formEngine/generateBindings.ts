// Thin wrapper around the generateBindingsWorkflow: AI-generate the
// bindings.ts that maps engine FormFields to a catalog's PDF widgets.
//
// Defaults:
//   --catalog defaults to forms/<jurisdiction>/<short>/catalog.json
//             (auto-discovered: federal/<short>, then state/ca/<short>, state/ny/<short>, …)
//   --output  derived from catalog location + formId:
//               federal  → src/engine/federal/<short>/bindings.ts
//               state/CA → src/engine/state/ca/<short>/bindings.ts
//             where <short> is the formId with "form-" stripped.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { runGenerateBindings } from "../../src/forms-pipeline/generateBindingsWorkflow/index.js";
import { projectRoot } from "../../src/paths.js";
import type { Command } from "../lib/cli";

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
// src/engine/state/<state>/<short>/bindings.ts. Federal catalog
// (forms/federal/<short>/) → src/engine/federal/<short>/bindings.ts.
function findDefaultOutput(formId: string, catalogPath: string): string {
  const shortName = formId.replace(/^form-/, "");
  const stateMatch = /\bforms\/state\/([a-z]+)\//.exec(catalogPath);
  if (stateMatch) {
    return resolve(
      projectRoot,
      `src/engine/state/${stateMatch[1]}/${shortName}/bindings.ts`,
    );
  }
  return resolve(
    projectRoot,
    `src/engine/federal/${shortName}/bindings.ts`,
  );
}

function parseCmdArgs(argv: string[]): Args {
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

async function run(argv: string[]): Promise<void> {
  const args = parseCmdArgs(argv);

  console.log(`generate-bindings: ${args.formId} (${args.taxYear})`);
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

export const generateBindingsCommand: Command = {
  name: "generate-bindings",
  summary: "AI-generate src/engine/<…>/bindings.ts from a form's catalog",
  options: [
    { flag: "--form-id=<id>", desc: "e.g. form-1040 (required)" },
    { flag: "--tax-year=<year>", desc: "e.g. 2025 (required)" },
    { flag: "--catalog=<path>", desc: "catalog.json (default: auto-discovered under forms/)" },
    { flag: "--output=<path>", desc: "bindings.ts (default: derived from catalog location)" },
    { flag: "--min-confidence=<l>", desc: "high | medium | low (default: high)" },
  ],
  run,
};
