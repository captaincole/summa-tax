// Catalog-fill test — validates a form catalog's completeness and per-field
// value-type integrity against its blank PDF, snapshotted as a golden file.
//
// For a given form-id: load its catalog + blank PDF, build an EvaluatedForm
// where every field has a deterministic synthetic value, render via
// fillFromCatalog, and diff the rendered map against the golden stored
// alongside the catalog.
//
//   npm run test:catalog-fill -- --form-id=form-8949 [--update]
//
// What this catches:
//   - widget the catalog references doesn't exist in the PDF
//   - catalog says `text` but the widget is actually a checkbox
//   - field's pdfWidgetName collides with another field's (same value
//     wouldn't surface this; per-field synthetic values do)
//   - any catalog field skipped by the renderer (size mismatch)
//   - drift from the last validated state (golden diff)
//
// First run: pass --update to bootstrap the golden + a filled PDF at
// /tmp/smoke-<formId>.pdf. Eyeball the PDF, commit the golden, then future
// runs (without --update) act as a regression check. Future expansion:
// runAll.ts can iterate every catalog with a sibling golden and run this
// check across all forms in one pre-commit pass.

import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import {
  loadFromFixture,
  type Catalog,
  type FieldInventory,
} from "../src/mastra/engine/catalog.js";
import { fillFromCatalog } from "../src/mastra/engine/render/fillFromCatalog.js";
import type {
  AnyFormField,
  EvaluatedForm,
} from "../src/mastra/engine/types.js";
import { projectRoot } from "../src/mastra/paths.js";

interface Args {
  formId: string;
  update: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const arg = argv.find((a) => a.startsWith(`${flag}=`));
    return arg ? arg.slice(flag.length + 1) : undefined;
  };
  const formId = get("--form-id");
  const update = argv.includes("--update");
  if (!formId) {
    throw new Error("Required: --form-id=<formId>. Optional: --update.");
  }
  return { formId, update };
}

// ─── Catalog discovery ──────────────────────────────────────────────────
//
// Walk `forms/` looking for a catalog.json whose form.formId matches.
// Small directory tree (one folder per form), cheap to scan exhaustively.

async function findCatalogPath(formId: string): Promise<string> {
  const formsRoot = resolve(projectRoot, "forms");
  const candidates = await collectCatalogJsons(formsRoot);
  for (const path of candidates) {
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { form?: { formId?: string } };
    if (parsed.form?.formId === formId) return path;
  }
  throw new Error(
    `No catalog.json with formId="${formId}" under ${formsRoot}. ` +
      `Did you run "npm run forms:ingest" for it?`,
  );
}

async function collectCatalogJsons(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await collectCatalogJsons(full)));
    } else if (e.isFile() && e.name === "catalog.json") {
      out.push(full);
    }
  }
  return out;
}

// ─── Synthetic value generation ─────────────────────────────────────────
//
// Deterministic per field. Two goals:
//   1. Match the renderer's shape expectations per (valueType, pdfFieldKind).
//   2. Make values per-field-unique so widget collisions (two fields
//      sharing a pdfWidgetName) surface as the wrong text being written.

function hashFieldId(id: string): number {
  return createHash("sha256").update(id).digest().readUInt32BE(0);
}

function syntheticValue(field: FieldInventory): unknown {
  const seed = hashFieldId(field.fieldId);
  const tag = seed.toString(36).slice(0, 5).toUpperCase();
  // Branch on the classifier's rich type, which distinguishes within the
  // coarse valueType buckets. Falls back to plain valueType for any catalog
  // missing valueTypeRich.
  const rich = field.valueTypeRich ?? field.valueType;

  // Small-maxLength fields are usually structural sub-parts (date
  // month/day/year, 2-letter state, 2-digit year suffix, credit code,
  // single-digit count) where the canonical synthetic — "01/15/2025",
  // "T-XXXXX", 4-digit money — overflows. The renderer's maxLength-expanding
  // fallback then writes the longer value anyway, which masks the bug
  // instead of failing the test. Produce a value of exactly maxLength,
  // deterministic from the seed so values stay per-field-unique. Numeric
  // fields get an actual number (renderer requires typeof === "number");
  // everything else gets a digit string.
  if (typeof field.maxLength === "number" && field.maxLength > 0 && field.maxLength <= 4) {
    const mod = 10 ** field.maxLength;
    if (field.valueType === "numeric") return seed % mod;
    return String(seed % mod).padStart(field.maxLength, "0");
  }

  switch (rich) {
    case "money":
    case "count":
    case "numeric":
      // 4-digit values keep us under common widget maxLength caps.
      return 1000 + (seed % 9000);
    case "ssn":
      return "123-45-6789";
    case "phone":
      return "555-123-4567";
    case "zip":
      return "94110";
    case "email":
      return `t-${tag.toLowerCase()}@example.com`;
    case "signature":
      // Signature widgets fall through to coerceTextValue as a plain string;
      // give them a per-field-unique tag like other text fields.
      return `T-${tag}`;
    case "boolean":
      return true;
    case "date":
      return "01/15/2025";
    case "single_select":
    case "multi_select":
      return field.options?.[0]?.value;
    case "text":
    default:
      // Per-field-unique tag so widget collisions surface as wrong text.
      return `T-${tag}`;
  }
}

// ─── EvaluatedForm builder ──────────────────────────────────────────────

function buildSyntheticForm(
  formId: string,
  catalog: Catalog,
): EvaluatedForm<AnyFormField> {
  const meta = catalog.getForm(formId);
  if (!meta) throw new Error(`Catalog missing form metadata for ${formId}`);

  const fields: AnyFormField[] = catalog.getFields(formId).map((inv) => ({
    formFieldKind: `${formId}.${inv.valueType}`,
    fieldId: inv.fieldId,
    label: inv.label,
    category: inv.category,
    valueType: inv.valueType,
    result: {
      ok: true as const,
      value: syntheticValue(inv),
      rationale: "smokeFormFill synthetic value",
      supportingFactKeys: [],
    },
  }));

  return {
    formId: meta.formId,
    jurisdiction: meta.jurisdiction,
    title: meta.title,
    taxYear: meta.taxYear,
    mustFile: {
      ok: true,
      value: true,
      rationale: "smokeFormFill",
      supportingFactKeys: [],
    },
    fields,
  };
}

// ─── Golden serialization ───────────────────────────────────────────────
//
// Stable JSON shape: rendered map → sorted array of [fieldId, widgets[]].
// widget entries omit absent text/checked fields so the diff is signal-only.

interface GoldenEntry {
  fieldId: string;
  widgets: Array<{ widgetName: string; text?: string; checked?: boolean }>;
}

interface Golden {
  formId: string;
  fieldCount: number;
  entries: GoldenEntry[];
}

function toGolden(
  formId: string,
  fieldCount: number,
  rendered: Map<string, Array<{ widgetName: string; text?: string; checked?: boolean }>>,
): Golden {
  const entries: GoldenEntry[] = [];
  for (const [fieldId, widgets] of rendered) {
    entries.push({
      fieldId,
      widgets: widgets.map((w) => {
        const out: GoldenEntry["widgets"][number] = { widgetName: w.widgetName };
        if (w.text !== undefined) out.text = w.text;
        if (w.checked !== undefined) out.checked = w.checked;
        return out;
      }),
    });
  }
  entries.sort((a, b) => a.fieldId.localeCompare(b.fieldId));
  return { formId, fieldCount, entries };
}

function diffGoldens(expected: Golden, actual: Golden): string[] {
  const diffs: string[] = [];
  if (expected.fieldCount !== actual.fieldCount) {
    diffs.push(
      `fieldCount: expected=${expected.fieldCount} actual=${actual.fieldCount}`,
    );
  }
  const expById = new Map(expected.entries.map((e) => [e.fieldId, e]));
  const actById = new Map(actual.entries.map((e) => [e.fieldId, e]));
  const allIds = new Set([...expById.keys(), ...actById.keys()]);
  for (const id of allIds) {
    const a = expById.get(id);
    const b = actById.get(id);
    if (!a) {
      diffs.push(`added field: ${id}`);
      continue;
    }
    if (!b) {
      diffs.push(`removed field: ${id}`);
      continue;
    }
    if (JSON.stringify(a.widgets) !== JSON.stringify(b.widgets)) {
      diffs.push(
        `changed: ${id}\n  expected: ${JSON.stringify(a.widgets)}\n  actual:   ${JSON.stringify(b.widgets)}`,
      );
    }
  }
  return diffs;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const catalogPath = await findCatalogPath(args.formId);
  const formDir = catalogPath.replace(/\/catalog\.json$/, "");
  const blankPath = join(formDir, "blank.pdf");
  const goldenPath = join(formDir, "catalog-fill-golden.json");

  console.log(`test:catalog-fill ${args.formId}${args.update ? " (--update)" : ""}`);
  console.log(`  catalog: ${catalogPath}`);
  console.log(`  blank:   ${blankPath}`);
  console.log(`  golden:  ${goldenPath}`);

  const catalog = await loadFromFixture(catalogPath);
  const fieldCount = catalog.getFields(args.formId).length;

  const blankPdfBytes = await fs.readFile(blankPath);
  const form = buildSyntheticForm(args.formId, catalog);

  const { pdfBytes, rendered, warnings } = await fillFromCatalog({
    blankPdfBytes,
    form,
    catalog,
  });

  // Layer 1: any warnings → fail. Catalog references widgets the PDF
  // can't satisfy (wrong name, wrong type, overflowing maxLength after
  // both fallbacks).
  if (warnings.length > 0) {
    console.error(`\nFAIL: ${warnings.length} render warning(s):`);
    for (const w of warnings) console.error(`  - ${w}`);
    process.exit(1);
  }

  // Layer 2: catalog completeness. Every field should have produced at
  // least one rendered widget. Fields with undefined synthetic values
  // (e.g. select with empty options) get silently skipped by the renderer
  // — surface them as missing.
  if (rendered.size !== fieldCount) {
    const renderedIds = new Set(rendered.keys());
    const missing = catalog
      .getFields(args.formId)
      .map((f) => f.fieldId)
      .filter((id) => !renderedIds.has(id));
    console.error(
      `\nFAIL: rendered ${rendered.size}/${fieldCount} fields. ` +
        `Missing (${missing.length}): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}`,
    );
    process.exit(1);
  }

  const actual = toGolden(args.formId, fieldCount, rendered);

  // Always write the filled PDF — handy reference even on green runs.
  const outPdfPath = `/tmp/smoke-${args.formId}.pdf`;
  await fs.writeFile(outPdfPath, pdfBytes);

  if (args.update) {
    await fs.writeFile(goldenPath, JSON.stringify(actual, null, 2) + "\n");
    console.log(`\nOK: wrote golden (${actual.entries.length} fields) and PDF`);
    console.log(`  golden: ${goldenPath}`);
    console.log(`  pdf:    ${outPdfPath}`);
    console.log(`\nEyeball the PDF, then commit the golden.`);
    return;
  }

  // Diff path: load golden, compare.
  let expectedRaw: string;
  try {
    expectedRaw = await fs.readFile(goldenPath, "utf8");
  } catch (err) {
    console.error(
      `\nFAIL: no golden at ${goldenPath}. Run with --update to create one.`,
    );
    process.exit(1);
  }
  const expected = JSON.parse(expectedRaw) as Golden;
  const diffs = diffGoldens(expected, actual);
  if (diffs.length > 0) {
    console.error(`\nFAIL: ${diffs.length} golden diff(s):`);
    for (const d of diffs.slice(0, 10)) console.error(`  - ${d}`);
    if (diffs.length > 10) console.error(`  …and ${diffs.length - 10} more`);
    console.error(
      `\nIf the change is intentional, re-run with --update to refresh the golden.`,
    );
    process.exit(1);
  }
  console.log(`\nOK: ${actual.entries.length} fields match golden`);
  console.log(`  pdf: ${outPdfPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
