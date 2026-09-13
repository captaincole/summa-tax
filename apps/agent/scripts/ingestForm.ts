// Phase C CLI — thin wrapper around the ingestFormWorkflow Mastra workflow.
//
//   npx tsx scripts/ingestForm.ts \
//     --pdf=forms/federal/1040/blank.pdf \
//     --form-id=form-1040 \
//     --tax-year=2025 \
//     --jurisdiction=federal \
//     --title="U.S. Individual Income Tax Return"
//
// Writes the classified catalog to
//   apps/agent/forms/<jurisdiction>/<short>/catalog.json
// where <short> is the formId with "form-" stripped.
// Pass --write-db to additionally upsert into the forms / form_fields tables.

import { resolve } from "node:path";
import { runIngestForm } from "../src/forms-pipeline/ingestFormWorkflow/index.js";
import { projectRoot } from "../src/paths.js";

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

// Co-locate the catalog with its source PDF: each form has its own folder
// under forms/<jurisdiction>/<short>/ containing blank.pdf + catalog.json
// (and the instructions sidecar, when ingested).
function defaultOutputDir(jurisdiction: string, formId: string): string {
  const shortName = formId.replace(/^form-/, "");
  if (jurisdiction === "federal") return `forms/federal/${shortName}`;
  if (jurisdiction.startsWith("state-")) {
    const state = jurisdiction.slice("state-".length);
    return `forms/state/${state}/${shortName}`;
  }
  return `forms/federal/${shortName}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = resolve(
    projectRoot,
    `${defaultOutputDir(args.jurisdiction, args.formId)}/catalog.json`,
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
    `  ${result.totalFields} fields total: ${result.enrichedCount} enriched, ${result.unenrichedCount} placeholder, ${result.skippedCount} skipped → ${result.catalogEntryCount} catalog entries`,
  );
  console.log(
    `  usage: input=${result.usage.input_tokens} output=${result.usage.output_tokens} cached_read=${result.usage.cache_read_input_tokens} cached_create=${result.usage.cache_creation_input_tokens}`,
  );
  if (result.dbWritten) {
    console.log(`  DB: forms + form_fields upserted (${result.catalogEntryCount} rows)`);
  }
  if (result.unenrichedSample.length > 0) {
    console.log(`  Unenriched fields (first ${result.unenrichedSample.length}):`);
    for (const n of result.unenrichedSample) console.log(`    - ${n}`);
    if (result.unenrichedCount > result.unenrichedSample.length) {
      console.log(`    … and ${result.unenrichedCount - result.unenrichedSample.length} more`);
    }
  }
  if (result.skipSample.length > 0) {
    console.log(`  Skipped fields (first ${result.skipSample.length}):`);
    for (const s of result.skipSample) {
      console.log(`    - ${s.pdfFieldName}: ${s.skipReason}`);
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
