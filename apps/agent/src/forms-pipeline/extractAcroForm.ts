// AcroForm widget extraction — the deterministic spine of Phase C.
//
// pdf-lib enumerates every fillable widget on the PDF: name, type, the
// page it lives on, and a bounding-box position. This is the trusted half
// of the Phase C pipeline; Claude classification only handles the parts
// that genuinely need judgment (label, category, valueType). Adapted from
// scripts/mapFieldsByPosition.ts and tightened into a reusable module.

import { readFile } from "node:fs/promises";
import {
  PDFCheckBox,
  PDFDocument,
  PDFRadioGroup,
  PDFTextField,
  type PDFField,
} from "pdf-lib";

export type WidgetKind = "text" | "checkbox" | "radio" | "other";

export interface ExtractedWidget {
  /** Full PDF widget name, e.g. `topmostSubform[0].Page1[0].f1_47[0]` —
   *  unique across the document. Maps to `pdf_widget_name` in the catalog. */
  fullName: string;
  /** Final segment of the name with the array suffix stripped, e.g. `f1_47`.
   *  Short labels are easier for humans + Claude to disambiguate. */
  shortName: string;
  kind: WidgetKind;
  /** 0-indexed page number where the widget appears. */
  page: number;
  /** Bounding box in PDF user units (origin bottom-left). */
  position: { x: number; y: number; width: number; height: number };
}

export interface ExtractedAcroForm {
  pdfPath: string;
  totalPages: number;
  widgets: ExtractedWidget[];
}

export async function extractAcroForm(pdfPath: string): Promise<ExtractedAcroForm> {
  const bytes = await readFile(pdfPath);
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const pages = pdf.getPages();

  const widgets: ExtractedWidget[] = [];

  for (const field of form.getFields()) {
    const kind = classifyKind(field);
    const fullName = field.getName();
    const shortName = shortenName(fullName);
    // pdf-lib's PDFField → acroField getWidgets() is the deterministic way
    // to enumerate every visual placement of the field (a single named
    // field can render to multiple widgets — e.g. a radio group spans many
    // visual checkboxes).
    const acroWidgets = (
      field as unknown as { acroField: { getWidgets: () => unknown[] } }
    ).acroField.getWidgets();
    for (const w of acroWidgets) {
      const widget = w as {
        getRectangle: () => { x: number; y: number; width: number; height: number };
        dict: unknown;
      };
      const rect = widget.getRectangle();
      const page = findWidgetPage(widget.dict, pages);
      widgets.push({
        fullName,
        shortName,
        kind,
        page,
        position: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      });
    }
  }

  // Sort top-to-bottom (within page) then left-to-right. Matches reading
  // order, which is also the natural ordinal sequence we want in the DB.
  widgets.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    // Higher y in PDF coords = higher on the page.
    if (Math.abs(a.position.y - b.position.y) > 3) {
      return b.position.y - a.position.y;
    }
    return a.position.x - b.position.x;
  });

  return {
    pdfPath,
    totalPages: pages.length,
    widgets,
  };
}

function classifyKind(field: PDFField): WidgetKind {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  return "other";
}

function shortenName(fullName: string): string {
  const segs = fullName.split(".");
  const last = segs[segs.length - 1] ?? fullName;
  return last.replace(/\[\d+\]$/, "");
}

// pdf-lib doesn't expose a direct "what page is this widget on?" API.
// Each page has an Annots array; we scan pages looking for one whose
// Annots array contains this widget's dict.
function findWidgetPage(
  widgetDict: unknown,
  pages: Array<{ node: { Annots: () => unknown } }>,
): number {
  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i].node.Annots();
    if (!annots) continue;
    const arr = (annots as { asArray: () => unknown[] }).asArray();
    if (arr.includes(widgetDict)) return i;
  }
  return 0;
}
