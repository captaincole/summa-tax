// AcroForm field extraction — the deterministic spine of form ingest.
//
// pdf-lib enumerates every PDFField on the form. For each field we capture:
//   - The AcroForm field name (e.g. `540_form_1036 RB` or `topmostSubform[0].Page1[0].f1_03[0]`)
//   - Its kind (text / checkbox / radio / signature / other) per pdf-lib's type system
//   - Per-kind metadata that the PDF actually carries: maxLength + multiline for text,
//     option labels for radio groups, on-value for checkboxes
//   - One or more widgets (visual occurrences) with page + position
//
// Returning fields (not widgets) means downstream code never has to guess at
// the structure of a radio group or recover field type from a flat widget
// list. AI classification gets handed a structured input and only enriches
// the parts it can — labels, fieldIds, semantic categories.

import { readFile } from "node:fs/promises";
import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFTextField,
  type PDFField,
} from "pdf-lib";

export type FieldKind = "text" | "checkbox" | "radio" | "signature" | "other";

export interface ExtractedFieldWidget {
  /** 0-indexed page where this visual occurrence lives. */
  page: number;
  position: { x: number; y: number; width: number; height: number };
}

export interface ExtractedField {
  /** Full AcroForm field name — unique across the PDF. */
  pdfFieldName: string;
  /** Last segment of the name with the array suffix stripped (`f1_47`, `540_form_1018`). */
  shortName: string;
  fieldKind: FieldKind;
  /** Text fields only. `null` when the field has no maxLength constraint. */
  maxLength?: number | null;
  /** Text fields only. */
  multiline?: boolean;
  /**
   * Radio groups only — option labels in PDF order, matching widgets[i] one-to-one.
   * Comes from PDFRadioGroup.getOptions(). The classifier gets these as ground
   * truth and just needs to assign stable `value` keys + a group-level label.
   */
  radioOptions?: string[];
  /**
   * Checkboxes only — the "on" appearance state name (typically "Yes" or "1").
   * The renderer calls `.check()` regardless; we record this for diagnostics
   * and for future flow control where the on-value matters.
   */
  checkboxOnValue?: string;
  /** One widget per visual occurrence on the form. Most fields have one. */
  widgets: ExtractedFieldWidget[];
}

export interface ExtractedAcroForm {
  pdfPath: string;
  totalPages: number;
  fields: ExtractedField[];
}

export async function extractAcroForm(pdfPath: string): Promise<ExtractedAcroForm> {
  const bytes = await readFile(pdfPath);
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const pages = pdf.getPages();

  // Map widget annotation dict → page index. Iterates each page's Annots
  // array, resolves each PDFRef to its dict, and records the dict→page
  // mapping. Widget objects share identity with these dicts, so a downstream
  // lookup gives us the correct page even on PDFs whose widget names lack
  // page markers (e.g. CA's flat `540_form_NNNN` scheme).
  const pageByDict = new Map<PDFDict, number>();
  for (let i = 0; i < pages.length; i++) {
    const annotsField = pages[i].node.lookup(PDFName.of("Annots"));
    if (!(annotsField instanceof PDFArray)) continue;
    for (let j = 0; j < annotsField.size(); j++) {
      const entry = annotsField.get(j);
      const dict =
        entry instanceof PDFRef ? pdf.context.lookup(entry) : entry;
      if (dict instanceof PDFDict) {
        pageByDict.set(dict, i);
      }
    }
  }

  const fields: ExtractedField[] = [];

  for (const field of form.getFields()) {
    const fieldKind = classifyKind(field);
    const fullName = field.getName();
    const shortName = shortenName(fullName);

    const acroWidgets = (
      field as unknown as { acroField: { getWidgets: () => unknown[] } }
    ).acroField.getWidgets();

    const widgets: ExtractedFieldWidget[] = [];
    for (const w of acroWidgets) {
      const widget = w as {
        getRectangle: () => { x: number; y: number; width: number; height: number };
        dict: PDFDict;
      };
      const rect = widget.getRectangle();
      const page =
        pageByDict.get(widget.dict) ??
        findWidgetPageByName(fullName, pages.length);
      widgets.push({
        page,
        position: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      });
    }

    const entry: ExtractedField = {
      pdfFieldName: fullName,
      shortName,
      fieldKind,
      widgets,
    };

    if (field instanceof PDFTextField) {
      const maxLength = field.getMaxLength();
      entry.maxLength = typeof maxLength === "number" ? maxLength : null;
      entry.multiline = field.isMultiline();
    } else if (field instanceof PDFRadioGroup) {
      entry.radioOptions = field.getOptions();
    } else if (field instanceof PDFCheckBox) {
      // pdf-lib doesn't expose a clean "on-value" accessor; the underlying
      // acroField has a `getOnValue()` that returns a PDFName. We stringify
      // it for diagnostics; the renderer just calls `.check()`.
      try {
        const acroCheck = (field as unknown as {
          acroField: { getOnValue: () => { encodedName?: string } | null };
        }).acroField;
        const on = acroCheck.getOnValue?.();
        if (on && on.encodedName) entry.checkboxOnValue = on.encodedName;
      } catch {
        /* not load-bearing — skip on failure */
      }
    }

    fields.push(entry);
  }

  // Sort fields by reading order of their first widget. Same convention as
  // the prior implementation so downstream ordinals match what's already in
  // the 1040 catalog.
  fields.sort((a, b) => {
    const aw = a.widgets[0];
    const bw = b.widgets[0];
    if (!aw || !bw) return 0;
    if (aw.page !== bw.page) return aw.page - bw.page;
    if (Math.abs(aw.position.y - bw.position.y) > 3) {
      return bw.position.y - aw.position.y;
    }
    return aw.position.x - bw.position.x;
  });

  return {
    pdfPath,
    totalPages: pages.length,
    fields,
  };
}

function classifyKind(field: PDFField): FieldKind {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFSignature) return "signature";
  return "other";
}

function shortenName(fullName: string): string {
  const segs = fullName.split(".");
  const last = segs[segs.length - 1] ?? fullName;
  return last.replace(/\[\d+\]$/, "");
}

// Fallback: parse the page index from the widget's full name. IRS forms
// nest widgets under topmostSubform[0].Page<N>[0] but other publishers
// (e.g. CA FTB) use flat names like `540_form_1042` with no page marker.
// The dict-based lookup above covers both; this only fires when the dict
// map didn't find the widget's annotation on any page.
function findWidgetPageByName(fullName: string, totalPages: number): number {
  const match = fullName.match(/Page(\d+)\[/);
  if (match) {
    const pageNum = parseInt(match[1], 10) - 1;
    if (pageNum >= 0 && pageNum < totalPages) return pageNum;
  }
  return 0;
}
