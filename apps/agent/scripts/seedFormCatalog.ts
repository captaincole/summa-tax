// Seed the `forms` + `form_fields` tables from the JSON fixtures in
// `apps/agent/fixtures/forms/`. Idempotent — re-running upserts the same
// rows by (form_id, tax_year) / (field_id, tax_year).
//
// Run: npx tsx scripts/seedFormCatalog.ts
//
// In Phase B the fixtures are authoritative and this script keeps the DB
// in sync so the DB loader path can be exercised. In Phase C+ the AI
// ingestion pipeline writes directly to these tables and this script
// becomes legacy (still useful for re-seeding a wiped dev environment).

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { getServiceRoleClient } from "../src/mastra/db/supabase.js";
import { projectRoot } from "../src/mastra/paths.js";
import type { FixtureFile } from "../src/mastra/forms/catalog.js";

const FIXTURE_PATHS = [
  resolve(projectRoot, "fixtures/forms/form-1040-2025.json"),
];

async function main() {
  const sb = getServiceRoleClient();

  let formsUpserted = 0;
  let fieldsUpserted = 0;

  for (const path of FIXTURE_PATHS) {
    const raw = await fs.readFile(path, "utf8");
    const fixture = JSON.parse(raw) as FixtureFile;
    const { form, fields } = fixture;

    const { error: formErr } = await sb.from("forms").upsert(
      {
        form_id: form.formId,
        tax_year: form.taxYear,
        jurisdiction: form.jurisdiction,
        title: form.title,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "form_id,tax_year" },
    );
    if (formErr) {
      throw new Error(
        `forms upsert failed for ${form.formId} ${form.taxYear}: ${formErr.message}`,
      );
    }
    formsUpserted++;

    const rows = fields.map((f, i) => ({
      field_id: f.fieldId,
      form_id: form.formId,
      tax_year: form.taxYear,
      ordinal: i,
      label: f.label,
      category: f.category,
      value_type: f.valueType,
      pdf_widget_name: f.pdfWidgetName ?? null,
      position: f.position ?? null,
      updated_at: new Date().toISOString(),
    }));

    const { error: fieldErr } = await sb.from("form_fields").upsert(rows, {
      onConflict: "field_id,tax_year",
    });
    if (fieldErr) {
      throw new Error(
        `form_fields upsert failed for ${form.formId} ${form.taxYear}: ${fieldErr.message}`,
      );
    }
    fieldsUpserted += rows.length;

    console.log(
      `  ✓ ${form.formId} (${form.taxYear}) — ${rows.length} fields upserted`,
    );
  }

  console.log(
    `\nSeeded ${formsUpserted} form(s), ${fieldsUpserted} field(s).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
