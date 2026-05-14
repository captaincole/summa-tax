// Form-field extraction via pdf.js (through unpdf).
//
// Replaces extractAcroForm.ts + extractFormText.ts. The pipeline is
// deterministic in structure; only LABEL resolution involves AI (and only
// for widgets that don't carry their own /TU alt-text).
//
// Two label tiers:
//   tier 1 — annotation.alternativeText (/TU). Author-provided user name.
//            CA 540 has these for every field; IRS 1040 strips them.
//   tier 2 — vision LLM. Page is rasterized, widget rectangles are overlaid
//            with numbered badges, and Claude returns one label per widget.
//            Widgets that already have a /TU value get it echoed back as a
//            cross-check (the prompt says "defer to tu_label verbatim").
//
// Tier 3 (would-be positional inference) is disabled by policy. If vision
// fails to return a label for a widget, we throw — the form needs human
// attention, not a silent fallback.
//
// Field-kind, max length, radio options, checkbox on-values, and widget
// positions are read straight from pdf.js's annotation objects. pdf-lib is
// not used here.

import { readFile } from "node:fs/promises";
import { createIsomorphicCanvasFactory, getDocumentProxy } from "unpdf";
import { resolveLabelsForPage } from "./visionLabel.js";

const canvasImport = () => import("@napi-rs/canvas");

export type FieldKind = "text" | "checkbox" | "radio" | "signature" | "other";
export type LabelSource = "tu" | "vision";

export interface ExtractedFieldWidget {
  /** 0-indexed page where this visual occurrence lives. */
  page: number;
  position: { x: number; y: number; width: number; height: number };
  /** Radio buttons only — the option label for this specific widget. */
  buttonValue?: string;
}

export interface ExtractedField {
  /** Full AcroForm field name — unique across the PDF. */
  fieldName: string;
  /** Last segment of the name with the array suffix stripped (`f1_14`, `540_form_1018`). */
  shortName: string;
  fieldKind: FieldKind;
  /** Author label resolved by tier-1 (/TU) or tier-2 (vision). */
  label: string;
  labelSource: LabelSource;
  /** Text fields only. `null` when the field has no maxLength constraint. */
  maxLength?: number | null;
  /** Text fields only. */
  multiline?: boolean;
  /** Text fields only — combs are character-cell fixed-width text fields (SSN boxes). */
  comb?: boolean;
  /** Radio groups only — option labels in widget order. */
  radioOptions?: string[];
  /** Checkboxes only — the "on" appearance state name (typically "Yes" or "1"). */
  checkboxOnValue?: string;
  /** One widget per visual occurrence. Most fields have exactly one. */
  widgets: ExtractedFieldWidget[];
}

export interface ExtractedForm {
  pdfPath: string;
  totalPages: number;
  fields: ExtractedField[];
}

export interface CoverageReport {
  totalFields: number;
  tier1Count: number;
  tier2Count: number;
}

/** Throw subclass so callers can `instanceof`-detect missing-label failures. */
export class MissingLabelError extends Error {
  fieldName: string;
  pdfPath: string;
  constructor(opts: { fieldName: string; pdfPath: string }) {
    super(
      `extractFormFields(${opts.pdfPath}): widget "${opts.fieldName}" has no ` +
        `label after tier-1 (/TU) and tier-2 (vision). The vision step did ` +
        `not return a label for this widget. Investigate the page render + ` +
        `overlay or escalate to manual review.`,
    );
    this.name = "MissingLabelError";
    this.fieldName = opts.fieldName;
    this.pdfPath = opts.pdfPath;
  }
}

interface PageWidget {
  pdfWidgetId: number; // monotonic per page, used as overlay badge number
  annot: any;
  rect: [number, number, number, number];
}

export async function extractFormFields(pdfPath: string): Promise<ExtractedForm> {
  const bytes = await readFile(pdfPath);
  // Pass canvasFactory at document-load time so pdf.js's internal render path
  // (text extraction, getAnnotations) has canvas available. Without this,
  // forms whose annotations need transparency-group resolution fail with
  // "@napi-rs/canvas is not available".
  const CanvasFactory = await createIsomorphicCanvasFactory(canvasImport);
  const pdf = await getDocumentProxy(new Uint8Array(bytes), {
    CanvasFactory,
  } as any);
  const totalPages = pdf.numPages;

  // Tier-1 labels are field-scoped (same fieldName always gets the same /TU).
  // We collect them up-front from any widget occurrence, then never lose them.
  const tier1Labels = new Map<string, string>();
  const tier2Labels = new Map<string, string>();

  // Group widgets by fieldName for the final ExtractedField[]. Also remember
  // each widget's page so the vision step can group correctly.
  const widgetsByFieldName = new Map<string, Array<{ annot: any; page: number; rect: [number, number, number, number] }>>();
  const widgetsByPage = new Map<number, PageWidget[]>();

  for (let p = 1; p <= totalPages; p++) {
    const page = await pdf.getPage(p);
    const annots = await page.getAnnotations();
    const pageIdx = p - 1;
    const rawWidgets: Array<{
      annot: any;
      rect: [number, number, number, number];
    }> = [];

    for (const a of annots) {
      if (a.subtype !== "Widget") continue;
      const rect = a.rect as [number, number, number, number];
      const fieldName = a.fieldName as string;

      let bucket = widgetsByFieldName.get(fieldName);
      if (!bucket) {
        bucket = [];
        widgetsByFieldName.set(fieldName, bucket);
      }
      bucket.push({ annot: a, page: pageIdx, rect });

      const alt = a.alternativeText;
      if (
        !tier1Labels.has(fieldName) &&
        typeof alt === "string" &&
        alt.trim().length > 0
      ) {
        tier1Labels.set(fieldName, alt.trim());
      }

      rawWidgets.push({ annot: a, rect });
    }

    // Number badges in reading order (y desc, then x asc) so the model can
    // rely on the convention "badge 1 is top-left, badge N is bottom-right."
    // PDF y-axis is bottom-up so larger y = higher on the page.
    rawWidgets.sort((a, b) => {
      const ay = (a.rect[1] + a.rect[3]) / 2;
      const by = (b.rect[1] + b.rect[3]) / 2;
      if (Math.abs(ay - by) > 3) return by - ay;
      return a.rect[0] - b.rect[0];
    });

    const list: PageWidget[] = rawWidgets.map((w, i) => ({
      pdfWidgetId: i + 1,
      annot: w.annot,
      rect: w.rect,
    }));
    widgetsByPage.set(pageIdx, list);
  }

  // Tier 2 — call vision once per page that has at least one widget without a /TU label.
  for (let p = 0; p < totalPages; p++) {
    const pageWidgets = widgetsByPage.get(p) ?? [];
    if (pageWidgets.length === 0) continue;
    const allHaveTu = pageWidgets.every((w) =>
      tier1Labels.has(w.annot.fieldName as string),
    );
    if (allHaveTu) continue;

    const labels = await resolveLabelsForPage({
      pdfPath,
      pdf,
      pageIndex: p,
      widgets: pageWidgets.map((w) => ({
        id: w.pdfWidgetId,
        fieldName: w.annot.fieldName as string,
        kind: classifyKind(w.annot),
        rect: w.rect,
        exportValue:
          typeof w.annot.exportValue === "string" ? w.annot.exportValue : undefined,
        buttonValue:
          typeof w.annot.buttonValue === "string" ? w.annot.buttonValue : undefined,
        tuLabel: tier1Labels.get(w.annot.fieldName as string) ?? null,
      })),
    });

    // Apply vision labels back to fieldName. Multiple widgets sharing a
    // fieldName (e.g. CA 540's name field across pages 2-6) take the first
    // non-empty vision result.
    for (const w of pageWidgets) {
      const fn = w.annot.fieldName as string;
      if (tier1Labels.has(fn)) continue;
      if (tier2Labels.has(fn)) continue;
      const lab = labels.get(w.pdfWidgetId);
      if (lab && lab.trim().length > 0) {
        tier2Labels.set(fn, lab.trim());
      }
    }
  }

  const fields: ExtractedField[] = [];
  for (const [fieldName, occurrences] of widgetsByFieldName) {
    const head = occurrences[0].annot;
    const fieldKind = classifyKind(head);
    const shortName = shortenName(fieldName);

    let label: string;
    let labelSource: LabelSource;
    const t1 = tier1Labels.get(fieldName);
    const t2 = tier2Labels.get(fieldName);
    if (t1) {
      label = t1;
      labelSource = "tu";
    } else if (t2) {
      label = t2;
      labelSource = "vision";
    } else {
      throw new MissingLabelError({ fieldName, pdfPath });
    }

    const f: ExtractedField = {
      fieldName,
      shortName,
      fieldKind,
      label,
      labelSource,
      widgets: occurrences.map((occ) => ({
        page: occ.page,
        position: {
          x: occ.rect[0],
          y: occ.rect[1],
          width: occ.rect[2] - occ.rect[0],
          height: occ.rect[3] - occ.rect[1],
        },
        ...(fieldKind === "radio" && typeof occ.annot.buttonValue === "string"
          ? { buttonValue: occ.annot.buttonValue as string }
          : {}),
      })),
    };

    if (fieldKind === "text") {
      const ml = head.maxLen;
      f.maxLength = typeof ml === "number" && ml > 0 ? ml : null;
      f.multiline = !!head.multiLine;
      if (head.comb) f.comb = true;
    } else if (fieldKind === "checkbox") {
      if (typeof head.exportValue === "string") f.checkboxOnValue = head.exportValue;
    } else if (fieldKind === "radio") {
      f.radioOptions = occurrences
        .map((occ) => occ.annot.buttonValue)
        .filter((v): v is string => typeof v === "string");
    }

    fields.push(f);
  }

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

  return { pdfPath, totalPages, fields };
}

export function coverageReport(form: ExtractedForm): CoverageReport {
  let t1 = 0;
  let t2 = 0;
  for (const f of form.fields) {
    if (f.labelSource === "tu") t1++;
    else if (f.labelSource === "vision") t2++;
  }
  return { totalFields: form.fields.length, tier1Count: t1, tier2Count: t2 };
}

function classifyKind(annot: any): FieldKind {
  if (annot.fieldType === "Tx") return "text";
  if (annot.fieldType === "Btn") {
    if (annot.radioButton) return "radio";
    if (annot.checkBox) return "checkbox";
    return "other";
  }
  if (annot.fieldType === "Sig") return "signature";
  return "other";
}

function shortenName(fullName: string): string {
  const segs = fullName.split(".");
  const last = segs[segs.length - 1] ?? fullName;
  return last.replace(/\[\d+\]$/, "");
}
