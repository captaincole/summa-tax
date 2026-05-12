// Pure PDF-fill pipeline for Form 1040. Lifted out of the
// generate-tax-documents tool so the same code path is exercised by:
//   - the live tool (Supabase-fed facts → rendered PDF stored to Storage)
//   - the integration test suite (in-memory facts → in-memory PDF → assert)
// No I/O beyond the caller-supplied blank-PDF bytes; no database, no
// network. Side-effect-free except for mutating the in-memory PDF.
//
// Returns:
//   pdfBytes — the flattened, filled PDF
//   rendered — Map<fieldId, RenderedWidget[]> capturing what we actually
//              wrote, so tests can assert on rendered values rather than
//              re-reading widgets after flatten() (flatten destroys the
//              fillable AcroForm).
//   warnings — soft-failure log (widget missing, maxLength exceeded, etc.)
//              Tests treat any non-empty warnings as a regression.
//
// Behavior parity with the original inline loop in generateTaxDocuments:
//   - verifiedWidget overlay takes precedence over catalog pdfWidgetName
//   - missing/blocked/unsupported field results are skipped
//   - multi_select fields iterate inv.options to check per-option widgets
//   - numeric values render via fmtMoney (whole dollars, "0" for zero)

import { PDFDocument, PDFTextField, PDFCheckBox } from "pdf-lib";
import {
  type AnyFormField,
  type EvaluatedForm,
} from "../types.js";
import {
  type Catalog,
  type FieldInventory,
} from "../catalog.js";
import { verifiedWidget } from "../../../forms-pipeline/verifiedWidgets.js";

export interface RenderedWidget {
  widgetName: string;
  /** Text written for text/numeric/date fields. */
  text?: string;
  /** True if the widget was a checkbox that we checked. */
  checked?: boolean;
}

export interface FillForm1040Result {
  pdfBytes: Buffer;
  /** fieldId → list of widgets we wrote to (1+ entries; multi_select has many). */
  rendered: Map<string, RenderedWidget[]>;
  warnings: string[];
}

export async function fillForm1040(opts: {
  blankPdfBytes: Buffer | Uint8Array;
  form: EvaluatedForm<AnyFormField>;
  catalog: Catalog;
}): Promise<FillForm1040Result> {
  const { blankPdfBytes, form, catalog } = opts;
  const pdf = await PDFDocument.load(blankPdfBytes);
  const pdfForm = pdf.getForm();

  const rendered = new Map<string, RenderedWidget[]>();
  const warnings: string[] = [];

  const setText = (fieldId: string, widgetName: string, value: string) => {
    if (!value) return;
    let f;
    try {
      f = pdfForm.getField(widgetName);
    } catch (err) {
      warnings.push(
        `fieldId=${fieldId} widget=${widgetName} getField failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }
    if (!(f instanceof PDFTextField)) {
      warnings.push(
        `fieldId=${fieldId} widget=${widgetName} is ${f.constructor.name}, expected PDFTextField.`,
      );
      return;
    }
    // Most fields render their value verbatim. A handful of widgets have
    // maxLength constraints that conflict with the canonical fact format —
    // SSN widgets are 9-char digit-only (no dashes), phone widgets are
    // sometimes 10-char digit-only. When a length overflow happens, retry
    // with separators stripped before declaring it a soft failure. This
    // mirrors the IRS pattern: facts carry the human-readable format
    // ("###-##-####"); the PDF holds the bare digits.
    const written = trySetTextWithFallback(f, value);
    if (written === null) {
      warnings.push(
        `fieldId=${fieldId} widget=${widgetName} setText failed even after stripping separators (value="${value}").`,
      );
      return;
    }
    appendRendered(rendered, fieldId, { widgetName, text: written });
  };
  const check = (fieldId: string, widgetName: string) => {
    try {
      const f = pdfForm.getField(widgetName);
      if (f instanceof PDFCheckBox) {
        f.check();
        appendRendered(rendered, fieldId, { widgetName, checked: true });
      } else {
        warnings.push(
          `fieldId=${fieldId} widget=${widgetName} is ${f.constructor.name}, expected PDFCheckBox.`,
        );
      }
    } catch (err) {
      warnings.push(
        `fieldId=${fieldId} widget=${widgetName} check failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  for (const field of form.fields) {
    const inv = catalog.getField(field.fieldId);
    if (!inv) continue;
    if (!field.result.ok) continue;
    const value = field.result.value;
    if (value === null || value === undefined) continue;

    const widgetName =
      verifiedWidget(form.formId, field.fieldId) ?? inv.pdfWidgetName;
    fillByType(setText, check, widgetName, inv, value);
  }

  pdfForm.flatten();
  const pdfBytes = Buffer.from(await pdf.save());
  return { pdfBytes, rendered, warnings };
}

// Try setText(value); on length-overflow, retry with separators stripped.
// Returns the actually-written string, or null if both attempts failed.
function trySetTextWithFallback(f: PDFTextField, value: string): string | null {
  try {
    f.setText(value);
    return value;
  } catch (err) {
    if (!isLengthOverflow(err)) return null;
  }
  const stripped = value.replace(/[\s\-_.()]/g, "");
  if (stripped === value) return null; // nothing to strip; original failure stands
  try {
    f.setText(stripped);
    return stripped;
  } catch {
    return null;
  }
}

function isLengthOverflow(err: unknown): boolean {
  return err instanceof Error && /maxLength/i.test(err.message);
}

function appendRendered(
  map: Map<string, RenderedWidget[]>,
  fieldId: string,
  w: RenderedWidget,
): void {
  const arr = map.get(fieldId);
  if (arr) arr.push(w);
  else map.set(fieldId, [w]);
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n === 0) return "0";
  return Math.round(n).toString();
}

function fillByType(
  setText: (fieldId: string, widgetName: string, value: string) => void,
  check: (fieldId: string, widgetName: string) => void,
  widgetName: string | undefined,
  inv: FieldInventory,
  value: unknown,
): boolean {
  switch (inv.valueType) {
    case "numeric": {
      if (!widgetName) return false;
      if (typeof value === "number" && Number.isFinite(value)) {
        setText(inv.fieldId, widgetName, fmtMoney(value));
        return true;
      }
      return false;
    }
    case "text": {
      if (!widgetName) return false;
      if (typeof value === "string" && value.length > 0) {
        setText(inv.fieldId, widgetName, value);
        return true;
      }
      return false;
    }
    case "boolean": {
      if (!widgetName) return false;
      if (value === true) {
        check(inv.fieldId, widgetName);
        return true;
      }
      return false;
    }
    case "date": {
      if (!widgetName) return false;
      if (typeof value === "string" && value.length > 0) {
        setText(inv.fieldId, widgetName, value);
        return true;
      }
      return false;
    }
    case "multi_select": {
      if (!Array.isArray(value) || !inv.options) return false;
      let touched = false;
      for (const selected of value) {
        const opt = inv.options.find((o) => o.value === selected);
        if (!opt) continue;
        check(inv.fieldId, opt.pdfWidgetName);
        touched = true;
      }
      return touched;
    }
    case "single_select":
      return false;
  }
  return false;
}
