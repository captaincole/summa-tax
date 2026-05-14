// Read filled values out of a "golden" PDF — a CPA-completed form like
// Alex-1040-Golden.pdf — keyed by the full AcroForm widget name. The
// scenario runner uses this as the source of truth: our render must
// produce the same value at the same widget for every assertion.
//
// This is fundamentally different from the per-fieldId fixture assertions
// in expected.ts. Those trust the catalog's `fieldId → pdfWidgetName`
// mapping, so a mislabeled catalog passes even when the rendered PDF
// shows everything in the wrong place. Golden-widget comparison
// short-circuits the catalog entirely.

import { promises as fs } from "node:fs";
import {
  PDFCheckBox,
  PDFDocument,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";

export type GoldenKind = "text" | "checkbox" | "radio" | "other";

export interface GoldenValue {
  /** Full AcroForm widget name (e.g. `topmostSubform[0].Page1[0].f1_01[0]`). */
  widgetName: string;
  kind: GoldenKind;
  /**
   * Text fields: the rendered string ("" when blank).
   * Checkboxes: true when checked, false when not.
   * Radio groups: the selected option label string, or null when nothing is selected.
   */
  value: string | boolean | null;
}

/** Read every form widget's filled value out of a PDF. */
export async function readGoldenPdfValues(
  pdfPath: string,
): Promise<Map<string, GoldenValue>> {
  const bytes = await fs.readFile(pdfPath);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  const out = new Map<string, GoldenValue>();
  for (const field of form.getFields()) {
    const widgetName = field.getName();
    if (field instanceof PDFTextField) {
      out.set(widgetName, {
        widgetName,
        kind: "text",
        value: field.getText() ?? "",
      });
    } else if (field instanceof PDFCheckBox) {
      let checked = false;
      try {
        checked = field.isChecked();
      } catch {
        /* unset checkbox throws; treat as unchecked */
      }
      out.set(widgetName, { widgetName, kind: "checkbox", value: checked });
    } else if (field instanceof PDFRadioGroup) {
      const selected = field.getSelected();
      out.set(widgetName, {
        widgetName,
        kind: "radio",
        value: selected ?? null,
      });
    } else {
      out.set(widgetName, { widgetName, kind: "other", value: null });
    }
  }
  return out;
}

/**
 * Normalize text values for comparison. Empty strings, undefined, and null
 * all mean "blank"; whitespace differences should pass; SSN/phone we
 * compare digits-only because the renderer strips separators by convention.
 */
export function normalizeForCompare(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v.trim();
  return String(v);
}
