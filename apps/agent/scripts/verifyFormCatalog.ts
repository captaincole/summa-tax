// Verify the DB-backed Catalog matches the JSON fixtures it was seeded
// from. Run after `seedFormCatalog.ts` to confirm the round-trip.
//
// Run: npx tsx scripts/verifyFormCatalog.ts

import { resolve } from "node:path";
import { getServiceRoleClient } from "../src/mastra/db/supabase.js";
import { projectRoot } from "../src/mastra/paths.js";
import {
  loadFromDb,
  loadFromFixtures,
  type FieldInventory,
  type FormDefinition,
} from "../src/mastra/forms/catalog.js";

const FIXTURE_PATHS = [
  resolve(projectRoot, "fixtures/forms/form-1040-2025.json"),
];
const TAX_YEAR = 2025;

async function main() {
  const sb = getServiceRoleClient();

  const fromFixture = await loadFromFixtures(FIXTURE_PATHS);
  const fromDb = await loadFromDb(sb, TAX_YEAR);

  const failures: string[] = [];

  for (const ff of fromFixture.listForms()) {
    const db = fromDb.getForm(ff.formId);
    if (!db) {
      failures.push(`form ${ff.formId} missing in DB`);
      continue;
    }
    diffForm(ff, db, failures);

    const ffFields = fromFixture.getFields(ff.formId);
    const dbFields = fromDb.getFields(ff.formId);
    if (ffFields.length !== dbFields.length) {
      failures.push(
        `form ${ff.formId}: ${ffFields.length} fields in fixture vs ${dbFields.length} in DB`,
      );
    }
    for (const ffField of ffFields) {
      const dbField = fromDb.getField(ffField.fieldId);
      if (!dbField) {
        failures.push(`field ${ffField.fieldId} missing in DB`);
        continue;
      }
      diffField(ffField, dbField, failures);
    }
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} mismatch(es):`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(
    `\nCatalog round-trip ok — fixture and DB agree on every form + field.`,
  );
}

function diffForm(
  a: FormDefinition,
  b: FormDefinition,
  failures: string[],
): void {
  for (const k of ["formId", "taxYear", "jurisdiction", "title"] as const) {
    if (a[k] !== b[k]) {
      failures.push(`form ${a.formId} ${k}: fixture="${a[k]}" db="${b[k]}"`);
    }
  }
}

function diffField(
  a: FieldInventory,
  b: FieldInventory,
  failures: string[],
): void {
  for (const k of [
    "fieldId",
    "formId",
    "label",
    "category",
    "valueType",
    "ordinal",
  ] as const) {
    if (a[k] !== b[k]) {
      failures.push(`field ${a.fieldId} ${k}: fixture="${a[k]}" db="${b[k]}"`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
