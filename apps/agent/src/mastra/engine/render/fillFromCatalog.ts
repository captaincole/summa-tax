// Catalog-driven PDF-fill pipeline. Walks an EvaluatedForm + matching
// Catalog and writes each ok field result into its widget. Same code path
// is exercised by:
//   - the live tool (Supabase-fed facts → rendered PDF stored to Storage)
//   - the integration test suite (in-memory facts → in-memory PDF → assert)
//   - the smoke:form-fill harness (synthetic field results → golden diff)
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

import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup } from "pdf-lib";
import {
  type AnyFormField,
  type EvaluatedForm,
} from "../types.js";
import {
  type Catalog,
  type FieldInventory,
} from "../catalog.js";
import { getFormatter } from "../engine.js";
import { verifiedWidget } from "../../../forms-pipeline/verifiedWidgets.js";

export interface RenderedWidget {
  widgetName: string;
  /** Text written for text/numeric/date fields. */
  text?: string;
  /** True if the widget was a checkbox that we checked. */
  checked?: boolean;
}

export interface FillFromCatalogResult {
  pdfBytes: Buffer;
  /** fieldId → list of widgets we wrote to (1+ entries; multi_select has many). */
  rendered: Map<string, RenderedWidget[]>;
  warnings: string[];
}

export async function fillFromCatalog(opts: {
  blankPdfBytes: Buffer | Uint8Array;
  form: EvaluatedForm<AnyFormField>;
  catalog: Catalog;
}): Promise<FillFromCatalogResult> {
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
  // Radio-group select: the parent field is a PDFRadioGroup whose options
  // come from PDFRadioGroup.getOptions(). The catalog records the exact
  // option label per option; we call select(label) to pick it.
  const selectRadio = (fieldId: string, widgetName: string, radioOption: string) => {
    try {
      const f = pdfForm.getField(widgetName);
      if (f instanceof PDFRadioGroup) {
        f.select(radioOption);
        appendRendered(rendered, fieldId, { widgetName, text: radioOption });
      } else {
        warnings.push(
          `fieldId=${fieldId} widget=${widgetName} is ${f.constructor.name}, expected PDFRadioGroup.`,
        );
      }
    } catch (err) {
      warnings.push(
        `fieldId=${fieldId} widget=${widgetName} radio select(${radioOption}) failed: ${
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
    fillByType(setText, check, selectRadio, widgetName, inv, value);
  }

  pdfForm.flatten();
  const pdfBytes = Buffer.from(await pdf.save());
  return { pdfBytes, rendered, warnings };
}

// Try setText(value); on length-overflow, retry with separators stripped;
// on still-overflow, expand the widget's maxLength to fit and retry one
// more time. Since the renderer flattens the form before saving, expanding
// maxLength has no visual consequence — it just lets pdf-lib write the
// longer value through its strict validator. Returns the actually-written
// string, or null if all attempts failed.
function trySetTextWithFallback(f: PDFTextField, value: string): string | null {
  try {
    f.setText(value);
    return value;
  } catch (err) {
    if (!isLengthOverflow(err)) return null;
  }
  const stripped = value.replace(/[\s\-_.()]/g, "");
  if (stripped !== value) {
    try {
      f.setText(stripped);
      return stripped;
    } catch (err) {
      if (!isLengthOverflow(err)) return null;
    }
  }
  // Final attempt: expand the widget's maxLength to fit the value. PDF
  // viewers (and real users typing into the form) accept longer text than
  // the maxLength claims; the widget's declared limit is often
  // pessimistic (e.g. email widgets restricted to 12-15 chars despite
  // accepting 30+ in practice). Flattening hides the maxLength entirely.
  try {
    f.setMaxLength(value.length);
    f.setText(value);
    return value;
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
  // Comma-grouped whole dollars: 79000 → "79,000". Matches the IRS-form
  // convention the CPA-completed golden PDFs use.
  return Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// Pre-render value coercion for text fields. IRS/FTB convention: SSN and
// phone fields are digit-only regardless of the PDF widget's maxLength
// constraint — facts carry the readable form ("###-##-####",
// "###-###-####"), but every form (1040, 540, …) renders the bare digits.
// Branches on valueTypeRich (the classifier's structural verdict) rather
// than label-regex because the vision tier sometimes captures whole
// instructional sentences as the label (e.g. an 8949 page-2 "name" field
// whose label included the word "SSN" from neighbouring text).
function coerceTextValue(inv: FieldInventory, value: string): string {
  if (inv.valueTypeRich === "ssn" || inv.valueTypeRich === "phone") {
    return value.replace(/[^0-9]/g, "");
  }
  return value;
}

function fillByType(
  setText: (fieldId: string, widgetName: string, value: string) => void,
  check: (fieldId: string, widgetName: string) => void,
  selectRadio: (fieldId: string, widgetName: string, radioOption: string) => void,
  widgetName: string | undefined,
  inv: FieldInventory,
  value: unknown,
): boolean {
  // Per-field formatter override (registered via FormSpec.formatters in
  // a defineForm call). When present, the override decides exactly what
  // text gets written — bypasses the value-type defaults (fmtMoney,
  // coerceTextValue) so a form can opt into different conventions per
  // field. Example: 540 page 2 SSN renders with dashes via
  // formatters: { "page2.taxpayer_ssn": SSN.format }.
  const override = getFormatter(inv.fieldId);

  switch (inv.valueType) {
    case "numeric": {
      if (!widgetName) return false;
      if (typeof value === "number" && Number.isFinite(value)) {
        const text = override ? override(value as never) : fmtMoney(value);
        setText(inv.fieldId, widgetName, text);
        return true;
      }
      return false;
    }
    case "text": {
      if (!widgetName) return false;
      if (typeof value === "string" && value.length > 0) {
        const text = override
          ? override(value as never)
          : coerceTextValue(inv, value);
        setText(inv.fieldId, widgetName, text);
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
    case "multi_select":
    case "single_select": {
      // Both render the same way: walk the selected value(s) and toggle
      // the matching option's widget (per-checkbox 1040-style) or call
      // PDFRadioGroup.select(label) (radio-group 540-style). single_select
      // semantically means "exactly one selected"; multi_select means
      // "zero or more." The renderer doesn't care about the distinction —
      // it just iterates whichever value(s) are present.
      if (!inv.options) return false;
      const selectedValues = Array.isArray(value) ? value : [value];
      let touched = false;
      for (const selected of selectedValues) {
        const opt = inv.options.find((o) => o.value === selected);
        if (!opt) continue;
        if (opt.radioOption && widgetName) {
          selectRadio(inv.fieldId, widgetName, opt.radioOption);
          touched = true;
        } else if (opt.pdfWidgetName) {
          check(inv.fieldId, opt.pdfWidgetName);
          touched = true;
        }
      }
      return touched;
    }
  }
  return false;
}
