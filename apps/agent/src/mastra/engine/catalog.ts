// Form Catalog — the read model the engine evaluates against.
//
// Inventory (label, category, valueType, position) lives here and is
// shared across forms. The per-form bindings files (forms/<jurisdiction>/
// <short>/bindings.ts) declare only the *behavior* layer (typed
// (f, info) => value functions registered via defineForm). The Catalog
// has two backing stores:
//
//   - JSON fixture (apps/agent/fixtures/forms/<formId>-<taxYear>.json) —
//     the source of truth checked into the repo. Always loadable in tests,
//     no DB required.
//   - Supabase tables (`forms`, `form_fields`) — the staging area the AI
//     ingestion pipeline writes into starting in Phase C. Seeded from the
//     JSON fixture so the runtime can switch between them transparently.
//
// Both loaders return a `Catalog` of the same shape. Phase E's diff
// (AI-generated vs hand-written) compares the contents of the two stores.

import { promises as fs } from "node:fs";
import { z } from "zod";
import type { Category, FieldValueType } from "./types.js";

// ─── Shapes ──────────────────────────────────────────────────────────────

export interface FormDefinition {
  formId: string;
  taxYear: number;
  jurisdiction: string;
  title: string;
}

export interface FieldOption {
  /** Stable selection value, e.g. "single" / "mfj" / "yes" / "checking". */
  value: string;
  /**
   * PDF AcroForm widget name that gets checked when this option is selected.
   * Set when each option is its own checkbox widget (e.g. Form 1040's
   * filing-status checkboxes). Unset for true PDFRadioGroup fields where the
   * group is a single AcroForm field — the parent FieldInventory.pdfWidgetName
   * names the group and the renderer calls `.select(radioOption)` instead.
   */
  pdfWidgetName?: string;
  /**
   * For PDFRadioGroup-backed options: the exact option label from
   * `PDFRadioGroup.getOptions()`. The renderer passes this verbatim to
   * `.select(...)`. Mutually exclusive with `pdfWidgetName`.
   */
  radioOption?: string;
  /** Optional human label for the option (UI display, not required for fill). */
  label?: string;
}

export type PdfFieldKind = "text" | "checkbox" | "radio" | "signature" | "other";

export interface FieldInventory {
  fieldId: string;
  formId: string;
  label: string;
  category: Category;
  valueType: FieldValueType;
  /**
   * Richer value-type from the classifier — distinguishes within the coarse
   * buckets (e.g. "money" vs "count" both narrow to numeric; "ssn" / "phone"
   * / "zip" / "email" / "signature" all narrow to text). Consumers that
   * format values per shape (renderer SSN-digit-stripping, smoke-test
   * synthetic-value generator) branch on this rather than label-regexing.
   * Optional for backwards-compat; every post-pipeline-rewrite catalog
   * carries it.
   */
  valueTypeRich?: string;
  /**
   * Deterministic structural type from pdf-lib. Optional for backwards-compat
   * with catalogs ingested before this field existed (pre-pipeline-rewrite
   * 1040 catalog). New catalogs always carry it; consumers that need the
   * structural truth (e.g. "is this a real radio group?") read this rather
   * than valueType.
   */
  pdfFieldKind?: PdfFieldKind;
  pdfWidgetName?: string;
  position?: { page: number; x: number; y: number };
  /**
   * For multi_select fields: the set of selectable values and the PDF
   * AcroForm widget each one toggles. Required when valueType ===
   * "multi_select"; ignored otherwise. Each option carries its own
   * pdfWidgetName because one form field can map to multiple underlying
   * widgets (e.g. filing_status has 5 options across 3 AcroForm fields).
   */
  options?: FieldOption[];
  /**
   * Widget-level character cap from the PDF AcroForm. Small values (≤ 4)
   * usually signal a structural sub-field — date components, 2-letter state,
   * 2-digit year, credit code — where the renderer needs a digit/letter
   * subset rather than the canonical fact value. The renderer treats this
   * as advisory (expands when needed); test harnesses honor it strictly to
   * generate values that won't overflow.
   */
  maxLength?: number;
  /** Stable ordinal among the form's fields. Drives evaluation + display order. */
  ordinal: number;
}

export interface Catalog {
  /** Look up a form's static metadata. */
  getForm(formId: string): FormDefinition | undefined;
  /** Inventory rows for a single form, in ordinal order. */
  getFields(formId: string): FieldInventory[];
  /** Inventory row for a single field, regardless of form. */
  getField(fieldId: string): FieldInventory | undefined;
  /** Every registered form. */
  listForms(): FormDefinition[];
}

interface CatalogPayload {
  forms: FormDefinition[];
  fields: FieldInventory[];
}

// ─── In-memory implementation ────────────────────────────────────────────

function buildCatalog(payload: CatalogPayload): Catalog {
  const formsById = new Map<string, FormDefinition>();
  for (const f of payload.forms) {
    formsById.set(f.formId, f);
  }
  const fieldsByForm = new Map<string, FieldInventory[]>();
  const fieldsById = new Map<string, FieldInventory>();
  for (const field of payload.fields) {
    fieldsById.set(field.fieldId, field);
    const list = fieldsByForm.get(field.formId) ?? [];
    list.push(field);
    fieldsByForm.set(field.formId, list);
  }
  for (const list of fieldsByForm.values()) {
    list.sort((a, b) => a.ordinal - b.ordinal);
  }
  return {
    getForm: (formId) => formsById.get(formId),
    getFields: (formId) => fieldsByForm.get(formId) ?? [],
    getField: (fieldId) => fieldsById.get(fieldId),
    listForms: () => Array.from(formsById.values()),
  };
}

// ─── Fixture loader (JSON file on disk) ──────────────────────────────────

export interface FixtureFile {
  form: FormDefinition;
  fields: Array<Omit<FieldInventory, "formId" | "ordinal">>;
}

// ─── Zod schema for catalog.json validation ──────────────────────────────
//
// Mirrors the TypeScript types above so that static JSON imports in
// registry.ts can be validated at module load. Without this, TS widens
// JSON string-valued fields (e.g. `category: "personal_info"`) to plain
// `string`, which won't satisfy our `Category` / `FieldValueType` unions
// — and `import x from ".../catalog.json"` followed by passing `x` to
// FixtureFile-typed code errors with an unfixable structural mismatch.
// fixtureFileSchema.parse(x) narrows correctly and fails loud on drift
// (renamed category, typo'd valueType, ingestion-pipeline schema change).
//
// Unknown keys (`labelSource`, `multiline`, top-level `_meta`) are
// emitted by the ingestion pipeline but unused by the engine — Zod
// strips them by default.

const categoryEnum = z.enum([
  "personal_info",
  "filing_scope",
  "income",
  "deductions_credits",
  "other",
]);

const fieldValueTypeEnum = z.enum([
  "numeric",
  "single_select",
  "multi_select",
  "text",
  "boolean",
  "date",
]);

const pdfFieldKindEnum = z.enum([
  "text",
  "checkbox",
  "radio",
  "signature",
  "other",
]);

const fieldOptionSchema = z.object({
  value: z.string(),
  pdfWidgetName: z.string().optional(),
  radioOption: z.string().optional(),
  label: z.string().optional(),
});

const fieldInventoryInputSchema = z.object({
  fieldId: z.string(),
  label: z.string(),
  category: categoryEnum,
  valueType: fieldValueTypeEnum,
  valueTypeRich: z.string().optional(),
  pdfFieldKind: pdfFieldKindEnum.optional(),
  pdfWidgetName: z.string().optional(),
  position: z
    .object({ page: z.number(), x: z.number(), y: z.number() })
    .optional(),
  options: z.array(fieldOptionSchema).optional(),
  maxLength: z.number().optional(),
});

const formDefinitionSchema = z.object({
  formId: z.string(),
  taxYear: z.number(),
  jurisdiction: z.string(),
  title: z.string(),
});

export const fixtureFileSchema = z.object({
  form: formDefinitionSchema,
  fields: z.array(fieldInventoryInputSchema),
}) satisfies z.ZodType<FixtureFile>;

/**
 * Load a Catalog from a single fixture file. The file holds one form's
 * inventory; multi-form catalogs are composed by `loadFromFixtures([…])`.
 */
export async function loadFromFixture(filePath: string): Promise<Catalog> {
  return loadFromFixtures([filePath]);
}

export async function loadFromFixtures(filePaths: string[]): Promise<Catalog> {
  const fixtures: FixtureFile[] = [];
  for (const path of filePaths) {
    const raw = await fs.readFile(path, "utf8");
    fixtures.push(JSON.parse(raw) as FixtureFile);
  }
  return buildCatalogFromFixtures(fixtures);
}

/**
 * Build a Catalog from FixtureFile objects already in memory — used by the
 * prod hot path, which imports catalog.json files statically (so Rollup
 * bundles them and the function doesn't depend on filesystem layout under
 * /var/task on Vercel). The fs-based loaders above stay for tests/scripts
 * that load arbitrary catalog paths at runtime.
 */
export function buildCatalogFromFixtures(fixtures: FixtureFile[]): Catalog {
  const forms: FormDefinition[] = [];
  const fields: FieldInventory[] = [];
  for (const fx of fixtures) {
    forms.push(fx.form);
    fx.fields.forEach((f, i) => {
      fields.push({
        ...f,
        formId: fx.form.formId,
        ordinal: i,
      });
    });
  }
  return buildCatalog({ forms, fields });
}

// ─── DB loader ───────────────────────────────────────────────────────────

/**
 * Load a Catalog for a given tax year out of the libsql corpus DB. Reads
 * everything in two queries (forms, then fields) — there's no per-form
 * filtering on the runtime path because the engine consults the Catalog
 * repeatedly and we'd rather pay one round-trip up front than N during
 * evaluation.
 *
 * Dormant: the runtime uses loadFromFixtures (the JSON path is
 * authoritative); this becomes live when the AI ingestion pipeline output
 * is trusted (Phase C+ of the forms-catalog plan).
 */
export async function loadFromDb(taxYear: number): Promise<Catalog> {
  const { getCorpusDb, ensureCorpusSchema } = await import("../db/libsql.js");
  await ensureCorpusSchema();
  const db = getCorpusDb();

  const formRows = await db.execute({
    sql: `SELECT form_id, tax_year, jurisdiction, title FROM forms WHERE tax_year = ?`,
    args: [taxYear],
  });
  const forms: FormDefinition[] = formRows.rows.map((r) => ({
    formId: String(r.form_id),
    taxYear: Number(r.tax_year),
    jurisdiction: String(r.jurisdiction),
    title: String(r.title),
  }));

  // TODO(db): add an `options` column (JSON) to `form_fields` and read it
  // here once multi_select fields need to live in the DB. Runtime currently
  // uses loadFromFixtures, so the JSON path is authoritative.
  const fieldRows = await db.execute({
    sql: `SELECT field_id, form_id, tax_year, label, category, value_type,
                 pdf_widget_name, position, ordinal
          FROM form_fields WHERE tax_year = ?
          ORDER BY form_id, ordinal`,
    args: [taxYear],
  });
  const fields: FieldInventory[] = fieldRows.rows.map((r) => ({
    fieldId: String(r.field_id),
    formId: String(r.form_id),
    label: String(r.label),
    category: String(r.category) as Category,
    valueType: String(r.value_type) as FieldValueType,
    pdfWidgetName: r.pdf_widget_name == null ? undefined : String(r.pdf_widget_name),
    position:
      r.position == null
        ? undefined
        : (JSON.parse(String(r.position)) as { page: number; x: number; y: number }),
    ordinal: Number(r.ordinal),
  }));

  return buildCatalog({ forms, fields });
}

// ─── Pure utility (used by smoke tests and the seed script) ─────────────

/** Build a Catalog from in-memory data — bypasses I/O. */
export function makeCatalog(payload: CatalogPayload): Catalog {
  return buildCatalog(payload);
}
