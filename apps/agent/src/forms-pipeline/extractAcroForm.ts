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
      };
      const rect = widget.getRectangle();
      const page = findWidgetPage(fullName, pages.length);
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

// pdf-lib's PDFRef vs. PDFDict comparison doesn't reliably resolve annot
// references on these forms (pdf-lib warns about stripping XFA data on
// load, which seems to leave the annot-array references in an unresolvable
// state). The existing scripts/mapFieldsByPosition.ts has the same bug.
//
// Workaround: parse the page index from the widget's full name. IRS forms
// (and most fillable government PDFs) encode page in the subform path:
//   topmostSubform[0].Page1[0].f1_47[0]   → page 0 (0-indexed)
//   topmostSubform[0].Page2[0].f2_01[0]   → page 1
//
// Falls back to 0 when no page marker is found (rare; usually means a
// flat single-page form).
function findWidgetPage(fullName: string, totalPages: number): number {
  const match = fullName.match(/Page(\d+)\[/);
  if (match) {
    const pageNum = parseInt(match[1], 10) - 1;
    if (pageNum >= 0 && pageNum < totalPages) return pageNum;
  }
  return 0;
}
