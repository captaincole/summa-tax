// Phase C CLI — thin wrapper around the ingestFormWorkflow Mastra workflow.
//
//   npx tsx scripts/ingestForm.ts \
//     --pdf=ref/forms/f1040-2025.pdf \
//     --form-id=form-1040 \
//     --tax-year=2025 \
//     --jurisdiction=federal \
//     --title="U.S. Individual Income Tax Return"
//
// Writes the classified catalog to
//   apps/agent/fixtures/forms/<form-id>-<tax-year>.extracted.json
// Pass --write-db to additionally upsert into the forms / form_fields tables.

import { resolve } from "node:path";
import { runIngestForm } from "../src/forms-pipeline/ingestFormWorkflow/index.js";
import { projectRoot } from "../src/mastra/paths.js";

interface Args {
  pdf: string;
  formId: string;
  taxYear: number;
  jurisdiction: string;
  title: string;
  writeDb: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const arg = argv.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.slice(flag.length + 1) : undefined;
  };
  const pdf = get("--pdf");
  const formId = get("--form-id");
  const taxYearStr = get("--tax-year");
  const jurisdiction = get("--jurisdiction") ?? "federal";
  const title = get("--title");
  const writeDb = argv.includes("--write-db");
  if (!pdf || !formId || !taxYearStr || !title) {
    throw new Error(
      "Required: --pdf, --form-id, --tax-year, --title. Optional: --jurisdiction (default federal), --write-db.",
    );
  }
  return {
    pdf: resolve(pdf),
    formId,
    taxYear: parseInt(taxYearStr, 10),
    jurisdiction,
    title,
    writeDb,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = resolve(
    projectRoot,
    `fixtures/forms/${args.formId}-${args.taxYear}.extracted.json`,
  );

  console.log(`Phase C ingest: ${args.formId} (${args.taxYear})`);
  console.log(`  PDF:    ${args.pdf}`);
  console.log(`  Output: ${outputPath}`);
  if (args.writeDb) console.log(`  --write-db: forms + form_fields will be upserted`);
  console.log();

  const result = await runIngestForm({
    pdfPath: args.pdf,
    formId: args.formId,
    taxYear: args.taxYear,
    jurisdiction: args.jurisdiction,
    formTitle: args.title,
    outputPath,
    writeDb: args.writeDb,
  });

  console.log(
    `  ${result.classifiedCount} classified, ${result.skippedCount} skipped, ${result.uniqueFieldCount} unique fields after dedup`,
  );
  console.log(
    `  usage: input=${result.usage.input_tokens} output=${result.usage.output_tokens} cached_read=${result.usage.cache_read_input_tokens} cached_create=${result.usage.cache_creation_input_tokens}`,
  );
  if (result.dbWritten) {
    console.log(`  DB: forms + form_fields upserted (${result.uniqueFieldCount} rows)`);
  }
  if (result.skipSample.length > 0) {
    console.log(`  Skipped widgets (first ${result.skipSample.length}):`);
    for (const s of result.skipSample) {
      console.log(`    - ${s.pdfWidgetName}: ${s.skipReason}`);
    }
    if (result.skippedCount > result.skipSample.length) {
      console.log(`    … and ${result.skippedCount - result.skipSample.length} more`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
