// Hand-verified fieldId → PDF widget mapping for known forms.
//
// Background: Phase C's AI extraction labels each AcroForm widget by
// reading nearby page text, and on densely-clustered widgets (header
// block, line-by-line income section) it fence-posts — i.e. confuses
// `your first name` with `spouse's first name`, or `line 10` with
// `line 9`. The deterministic widget LIST is correct (pdf-lib's
// AcroForm enumeration is reliable), but the label-to-widget pairing
// drifts.
//
// This file overlays a hand-verified mapping for the fields we know the
// AI got wrong. The renderer (generateTaxDocuments) checks this map
// first; falls back to the catalog's AI-supplied pdfWidgetName for
// fields not listed here.
//
// TODO(phase-c): improve Phase C extraction so the AI doesn't
// fence-post on adjacent widgets. Possible approaches:
//   - feed pdf-lib's full widget-name list + position table to Claude
//     in one pass (instead of letting Claude scan-and-label)
//   - validate alignment by cross-checking widget short names against
//     known IRS naming conventions (f1_14 = taxpayer, f1_19 = spouse, etc.)
//   - require operator confirmation when adjacent widgets share labels
// Once Phase C reliably maps widgets to fields, delete this file.

export const VERIFIED_WIDGETS: Record<string, Record<string, string>> = {
  // 2025 IRS Form 1040. Mappings verified by manual inspection of
  // ref/forms/f1040-2025.pdf — these are the same widget names the
  // pre-pipeline generateTaxDocuments hand-coded.
  "form-1040": {
    // Primary identity
    "form-1040.header.first_name": "topmostSubform[0].Page1[0].f1_14[0]",
    "form-1040.header.last_name": "topmostSubform[0].Page1[0].f1_15[0]",
    "form-1040.header.ssn": "topmostSubform[0].Page1[0].f1_16[0]",

    // Home address
    "form-1040.header.address_street":
      "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_20[0]",
    "form-1040.header.address_apt":
      "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_21[0]",
    "form-1040.header.address_city":
      "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_22[0]",
    "form-1040.header.address_state":
      "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_23[0]",
    "form-1040.header.address_zip":
      "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_24[0]",

    // Filing status checkboxes
    "form-1040.header.filing_status_single":
      "topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[0]",
    "form-1040.header.filing_status_mfj":
      "topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[1]",
    "form-1040.header.filing_status_mfs":
      "topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[2]",
    "form-1040.header.filing_status_hoh": "topmostSubform[0].Page1[0].c1_8[0]",
    "form-1040.header.filing_status_qss": "topmostSubform[0].Page1[0].c1_8[1]",

    // Income — page 1
    "form-1040.line.1a": "topmostSubform[0].Page1[0].f1_47[0]",
    "form-1040.line.1z": "topmostSubform[0].Page1[0].f1_57[0]",
    "form-1040.line.3a": "topmostSubform[0].Page1[0].f1_60[0]",
    "form-1040.line.3b": "topmostSubform[0].Page1[0].f1_61[0]",
    "form-1040.line.7a": "topmostSubform[0].Page1[0].f1_70[0]",
    "form-1040.line.9": "topmostSubform[0].Page1[0].f1_73[0]",
    "form-1040.line.10": "topmostSubform[0].Page1[0].f1_74[0]",
    "form-1040.line.11a": "topmostSubform[0].Page1[0].f1_75[0]",

    // Tax & credits — page 2
    "form-1040.line.11b": "topmostSubform[0].Page2[0].f2_01[0]",
    "form-1040.line.12e": "topmostSubform[0].Page2[0].f2_02[0]",
    "form-1040.line.14": "topmostSubform[0].Page2[0].f2_05[0]",
    "form-1040.line.15": "topmostSubform[0].Page2[0].f2_06[0]",
    "form-1040.line.16": "topmostSubform[0].Page2[0].f2_08[0]",
    "form-1040.line.18": "topmostSubform[0].Page2[0].f2_10[0]",
    "form-1040.line.22": "topmostSubform[0].Page2[0].f2_14[0]",
    "form-1040.line.24": "topmostSubform[0].Page2[0].f2_16[0]",
    "form-1040.line.25a": "topmostSubform[0].Page2[0].f2_17[0]",
    "form-1040.line.25d": "topmostSubform[0].Page2[0].f2_20[0]",
    "form-1040.line.33": "topmostSubform[0].Page2[0].f2_29[0]",
    "form-1040.line.34": "topmostSubform[0].Page2[0].f2_30[0]",
    "form-1040.line.35a": "topmostSubform[0].Page2[0].f2_31[0]",
    "form-1040.line.37": "topmostSubform[0].Page2[0].f2_35[0]",
  },
};

/**
 * Look up a verified widget name for a given (formId, fieldId). Returns
 * `null` when no verified mapping exists, so the renderer can fall back to
 * the AI catalog's pdfWidgetName.
 */
export function verifiedWidget(
  formId: string,
  fieldId: string,
): string | null {
  return VERIFIED_WIDGETS[formId]?.[fieldId] ?? null;
}
