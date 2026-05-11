// Form Catalog — the read model the engine evaluates against.
//
// In Phase A every form's inventory (label, category, valueType, position)
// lived inline in `bindField` calls. Phase B factors inventory out into a
// `Catalog`, leaving the generated TS to declare only the *behavior* layer
// (rule + params) for each field. The Catalog has two backing stores:
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
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, FieldValueType } from "./types.js";

// ─── Shapes ──────────────────────────────────────────────────────────────

export interface FormDefinition {
  formId: string;
  taxYear: number;
  jurisdiction: string;
  title: string;
}

export interface FieldInventory {
  fieldId: string;
  formId: string;
  label: string;
  category: Category;
  valueType: FieldValueType;
  pdfWidgetName?: string;
  position?: { page: number; x: number; y: number };
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

/**
 * Load a Catalog from a single fixture file. The file holds one form's
 * inventory; multi-form catalogs are composed by `loadFromFixtures([…])`.
 */
export async function loadFromFixture(filePath: string): Promise<Catalog> {
  return loadFromFixtures([filePath]);
}

export async function loadFromFixtures(filePaths: string[]): Promise<Catalog> {
  const forms: FormDefinition[] = [];
  const fields: FieldInventory[] = [];
  for (const path of filePaths) {
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as FixtureFile;
    forms.push(parsed.form);
    parsed.fields.forEach((f, i) => {
      fields.push({
        ...f,
        formId: parsed.form.formId,
        ordinal: i,
      });
    });
  }
  return buildCatalog({ forms, fields });
}

// ─── DB loader ───────────────────────────────────────────────────────────

/**
 * Load a Catalog for a given tax year out of Supabase. Reads everything in
 * two queries (forms, then fields) — there's no per-form filtering on the
 * runtime path because the engine consults the Catalog repeatedly and we'd
 * rather pay one round-trip up front than N during evaluation.
 *
 * Filled in alongside the seed script once `forms` / `form_fields` exist.
 */
export async function loadFromDb(
  supabase: SupabaseClient,
  taxYear: number,
): Promise<Catalog> {
  const { data: formRows, error: formErr } = await supabase
    .from("forms")
    .select("form_id, tax_year, jurisdiction, title")
    .eq("tax_year", taxYear);
  if (formErr) {
    throw new Error(`forms select failed: ${formErr.message}`);
  }
  const forms: FormDefinition[] = (formRows ?? []).map((r) => ({
    formId: r.form_id as string,
    taxYear: r.tax_year as number,
    jurisdiction: r.jurisdiction as string,
    title: r.title as string,
  }));

  const { data: fieldRows, error: fieldErr } = await supabase
    .from("form_fields")
    .select(
      "field_id, form_id, tax_year, label, category, value_type, pdf_widget_name, position, ordinal",
    )
    .eq("tax_year", taxYear)
    .order("form_id")
    .order("ordinal");
  if (fieldErr) {
    throw new Error(`form_fields select failed: ${fieldErr.message}`);
  }
  const fields: FieldInventory[] = (fieldRows ?? []).map((r) => ({
    fieldId: r.field_id as string,
    formId: r.form_id as string,
    label: r.label as string,
    category: r.category as Category,
    valueType: r.value_type as FieldValueType,
    pdfWidgetName: (r.pdf_widget_name as string | null) ?? undefined,
    position: (r.position as { page: number; x: number; y: number } | null) ??
      undefined,
    ordinal: r.ordinal as number,
  }));

  return buildCatalog({ forms, fields });
}

// ─── Pure utility (used by smoke tests and the seed script) ─────────────

/** Build a Catalog from in-memory data — bypasses I/O. */
export function makeCatalog(payload: CatalogPayload): Catalog {
  return buildCatalog(payload);
}
