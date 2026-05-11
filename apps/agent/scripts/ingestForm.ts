// Phase C CLI — ingest a form's PDF into a classified field catalog.
//
//   npx tsx scripts/ingestForm.ts \
//     --pdf=ref/forms/f1040-2025.pdf \
//     --form-id=form-1040 \
//     --tax-year=2025 \
//     --jurisdiction=federal \
//     --title="U.S. Individual Income Tax Return"
//
// Output: writes the classified catalog to
//   apps/agent/fixtures/forms/<form-id>-<tax-year>.extracted.json
// alongside the hand-written fixture (form-1040-2025.json) so Phase E can
// diff them without overwriting the baseline.
//
// Pass --write-db to additionally upsert into the `forms` and
// `form_fields` Supabase tables (idempotent, same shape as seedFormCatalog).

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { extractAcroForm } from "../src/forms-pipeline/extractAcroForm.js";
import { extractFormText } from "../src/forms-pipeline/extractFormText.js";
import { classifyWidgets } from "../src/forms-pipeline/classifyWidgets.js";
import { getServiceRoleClient } from "../src/mastra/db/supabase.js";
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

  console.log(`Phase C ingest: ${args.formId} (${args.taxYear})`);
  console.log(`  PDF: ${args.pdf}`);

  console.log(`  Extracting AcroForm widgets…`);
  const acro = await extractAcroForm(args.pdf);
  console.log(`    ${acro.widgets.length} widgets across ${acro.totalPages} pages`);

  console.log(`  Extracting page text…`);
  const pages = await extractFormText(args.pdf);
  const totalChars = pages.reduce((s, p) => s + p.text.length, 0);
  console.log(`    ${totalChars.toLocaleString()} characters of page text`);

  console.log(`  Classifying via Claude…`);
  const result = await classifyWidgets({
    formId: args.formId,
    taxYear: args.taxYear,
    jurisdiction: args.jurisdiction,
    formTitle: args.title,
    widgets: acro.widgets,
    pages,
  });
  console.log(
    `    classified=${result.fields.length} skipped=${result.skipped.length}`,
  );
  console.log(
    `    usage: input=${result.usage.input_tokens} output=${result.usage.output_tokens} cached_read=${result.usage.cache_read_input_tokens ?? 0} cached_create=${result.usage.cache_creation_input_tokens ?? 0}`,
  );

  // Build the catalog payload. Field rows carry their inventory + the
  // pdf_widget_name + position pulled from the deterministic extraction.
  // Order in the output reflects the AcroForm reading order — that's the
  // ordinal we want in the DB so engine evaluation runs top-to-bottom.
  const widgetByName = new Map(acro.widgets.map((w) => [w.fullName, w]));
  const classifiedByWidget = new Map(
    result.fields.map((f) => [f.pdfWidgetName, f]),
  );

  const fields = [];
  for (const w of acro.widgets) {
    const c = classifiedByWidget.get(w.fullName);
    if (!c) continue; // widget was skipped by the classifier
    fields.push({
      fieldId: c.fieldId,
      label: c.label,
      category: c.category,
      valueType: c.valueType,
      pdfWidgetName: w.fullName,
      position: {
        page: w.page,
        x: w.position.x,
        y: w.position.y,
      },
    });
  }

  // Multiple widgets can share a fieldId (e.g. five filing-status radio
  // checkboxes all become "form-1040.header.filing_status"). Keep the first
  // occurrence — the rest are duplicates from the perspective of the catalog.
  const seen = new Set<string>();
  const dedupedFields = fields.filter((f) => {
    if (seen.has(f.fieldId)) return false;
    seen.add(f.fieldId);
    return true;
  });

  const payload = {
    form: {
      formId: args.formId,
      taxYear: args.taxYear,
      jurisdiction: args.jurisdiction,
      title: args.title,
    },
    fields: dedupedFields,
    _meta: {
      sourcePdf: args.pdf,
      ingestedAt: new Date().toISOString(),
      totalWidgets: acro.widgets.length,
      classified: result.fields.length,
      skipped: result.skipped.length,
      uniqueFields: dedupedFields.length,
      tokensIn: result.usage.input_tokens,
      tokensOut: result.usage.output_tokens,
      cacheRead: result.usage.cache_read_input_tokens ?? 0,
      cacheCreate: result.usage.cache_creation_input_tokens ?? 0,
    },
  };

  const outPath = resolve(
    projectRoot,
    `fixtures/forms/${args.formId}-${args.taxYear}.extracted.json`,
  );
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`  Wrote ${outPath}`);
  console.log(`    ${dedupedFields.length} unique fields after dedup`);

  if (args.writeDb) {
    console.log(`  Upserting into Supabase forms + form_fields…`);
    const sb = getServiceRoleClient();
    const { error: formErr } = await sb.from("forms").upsert(
      {
        form_id: args.formId,
        tax_year: args.taxYear,
        jurisdiction: args.jurisdiction,
        title: args.title,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "form_id,tax_year" },
    );
    if (formErr) throw new Error(`forms upsert failed: ${formErr.message}`);

    const rows = dedupedFields.map((f, i) => ({
      field_id: f.fieldId,
      form_id: args.formId,
      tax_year: args.taxYear,
      ordinal: i,
      label: f.label,
      category: f.category,
      value_type: f.valueType,
      pdf_widget_name: f.pdfWidgetName,
      position: f.position,
      updated_at: new Date().toISOString(),
    }));
    const { error: fieldErr } = await sb.from("form_fields").upsert(rows, {
      onConflict: "field_id,tax_year",
    });
    if (fieldErr) throw new Error(`form_fields upsert failed: ${fieldErr.message}`);

    console.log(`    upserted ${rows.length} field row(s)`);
  }

  // Surface a few skips so the operator sees what was filtered. Useful for
  // catching mis-classifications where Claude dropped something it shouldn't have.
  if (result.skipped.length > 0) {
    const sample = result.skipped.slice(0, 8);
    console.log(`  Skipped widgets (first ${sample.length}):`);
    for (const s of sample) {
      console.log(`    - ${s.pdfWidgetName}: ${s.skipReason}`);
    }
    if (result.skipped.length > sample.length) {
      console.log(`    … and ${result.skipped.length - sample.length} more`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
