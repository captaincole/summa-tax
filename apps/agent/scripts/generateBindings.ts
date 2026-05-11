// Phase D CLI — thin wrapper around the generateBindingsWorkflow.
//
//   npx tsx --env-file=.env.development scripts/generateBindings.ts \
//     --form-id=form-1040 \
//     --tax-year=2025
//
// Defaults:
//   --catalog defaults to fixtures/forms/<form-id>-<tax-year>.extracted.json
//   --output  defaults to src/mastra/forms/generated/<form-id>.ts
//
// Both can be overridden with --catalog=… and --output=… flags.

import { resolve } from "node:path";
import { runGenerateBindings } from "../src/forms-pipeline/generateBindingsWorkflow/index.js";
import { projectRoot } from "../src/mastra/paths.js";

interface Args {
  formId: string;
  taxYear: number;
  catalogPath: string;
  outputPath: string;
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
  const catalogPath = resolve(
    get("--catalog") ??
      resolve(projectRoot, `fixtures/forms/${formId}-${taxYear}.extracted.json`),
  );
  const outputPath = resolve(
    get("--output") ??
      resolve(projectRoot, `src/mastra/forms/generated/${formId}.ts`),
  );
  return { formId, taxYear, catalogPath, outputPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`Phase D: generating bindings for ${args.formId} (${args.taxYear})`);
  console.log(`  Catalog: ${args.catalogPath}`);
  console.log(`  Output:  ${args.outputPath}`);
  console.log();

  const result = await runGenerateBindings({
    formId: args.formId,
    taxYear: args.taxYear,
    catalogPath: args.catalogPath,
    outputPath: args.outputPath,
  });

  console.log();
  console.log(
    `  Fields: ${result.fieldCount}, bindings: ${result.bindingsCount}, unbound: ${result.unboundCount}`,
  );
  console.log(`  Retrieved IRS context for ${result.retrievalCount} field(s)`);
  console.log(
    `  Usage: in=${result.usage.input_tokens} out=${result.usage.output_tokens} cache_read=${result.usage.cache_read_input_tokens} cache_create=${result.usage.cache_creation_input_tokens}`,
  );
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
