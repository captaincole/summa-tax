// Render Form 8949 (Sales and Other Dispositions of Capital Assets) into
// the IRS PDF template at ref/forms/f8949.pdf. Driven entirely off the
// EvaluatedForm8949 produced by the form engine.
//
// The 2025 form has two pages:
//   Page 1 = Part I (short-term), with checkboxes for Box A / B / C
//   Page 2 = Part II (long-term), with checkboxes for Box D / E / F
// Each page has 11 trade rows (Row1..Row11) × 8 columns (a-h) plus a
// "Line 2" totals row at the bottom (columns d, e, f, g, h).
//
// Field-name conventions (extracted via scripts/inspectPdfFields.ts):
//   Page 1 row N: topmostSubform[0].Page1[0].Table_Line1_Part1[0].RowN[0].f1_*[0]
//   Page 1 totals: topmostSubform[0].Page1[0].f1_91..f1_95
//   Page 2 row N: topmostSubform[0].Page2[0].Table_Line1_Part2[0].RowN[0].f2_*[0]
//   Page 2 totals: topmostSubform[0].Page2[0].f2_91..f2_95
//   Page 1 checkboxes: topmostSubform[0].Page1[0].c1_1[0..5]
//   Page 2 checkboxes: topmostSubform[0].Page2[0].c2_1[0..5]
// First three checkboxes per page are Box A/B/C and Box D/E/F respectively.
// The remaining three are uncertain (may be IRS-specific subsidiary
// checkboxes); we leave them unchecked.

import { PDFDocument, PDFTextField, PDFCheckBox } from "pdf-lib";
import type { EvaluatedForm8949 } from "../form8949";

interface Form8949RenderInput {
  templateBytes: Uint8Array;
  evaluated: EvaluatedForm8949;
  taxpayerName: string;       // "First Last"
  taxpayerSsn: string;        // raw digits or formatted
}

const PART1_BOX_TO_INDEX: Record<string, number> = {
  "partI.boxA": 0,
  "partI.boxB": 1,
  "partI.boxC": 2,
};
const PART2_BOX_TO_INDEX: Record<string, number> = {
  "partII.boxD": 0,
  "partII.boxE": 1,
  "partII.boxF": 2,
};

const fmtMoney = (n: number | undefined): string => {
  if (n === undefined || n === null) return "";
  if (n === 0) return "0";
  return Math.round(n).toString();
};

// Page-N row M starts at field index (row_first_field) and has 8 fields per
// row. Page1 starts at f1_03 (so Row1.col1 = f1_03 = index 3). Page2
// likewise starts at f2_03.
const rowFieldName = (page: 1 | 2, rowIdx: number, colIdx: number): string => {
  const fieldOffset = 3 + rowIdx * 8 + colIdx;  // Row1.col1=3, Row1.col2=4, ..., Row2.col1=11
  const p = page === 1 ? "1" : "2";
  return `topmostSubform[0].Page${page}[0].Table_Line1_Part${page}[0].Row${rowIdx + 1}[0].f${p}_${String(fieldOffset).padStart(2, "0")}[0]`;
};

const totalsFieldName = (page: 1 | 2, colIdx: number): string => {
  // Totals row 5 fields per page: f1_91..f1_95 (Page1) or f2_91..f2_95 (Page2)
  // Columns map (d, e, f, g, h) → (91, 92, 93, 94, 95)
  const p = page === 1 ? "1" : "2";
  return `topmostSubform[0].Page${page}[0].f${p}_${91 + colIdx}[0]`;
};

const checkboxFieldName = (page: 1 | 2, idx: number): string => {
  const p = page === 1 ? "1" : "2";
  return `topmostSubform[0].Page${page}[0].c${p}_1[${idx}]`;
};

const headerNameField = (page: 1 | 2): string => {
  const p = page === 1 ? "1" : "2";
  return `topmostSubform[0].Page${page}[0].f${p}_${page === 1 ? "01" : "01"}[0]`;
};
const headerSsnField = (page: 1 | 2): string => {
  const p = page === 1 ? "1" : "2";
  return `topmostSubform[0].Page${page}[0].f${p}_${page === 1 ? "02" : "02"}[0]`;
};

export async function renderForm8949Pdf(
  input: Form8949RenderInput,
): Promise<{ bytes: Uint8Array; linesPopulated: number }> {
  const { templateBytes, evaluated, taxpayerName, taxpayerSsn } = input;
  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();
  let linesPopulated = 0;

  const setText = (fieldName: string, value: string) => {
    if (!value) return;
    try {
      const f = form.getField(fieldName);
      if (f instanceof PDFTextField) f.setText(value);
    } catch (err) {
      console.warn(`[render-8949] setText ${fieldName} failed:`, err);
    }
  };
  const check = (fieldName: string) => {
    try {
      const f = form.getField(fieldName);
      if (f instanceof PDFCheckBox) f.check();
    } catch (err) {
      console.warn(`[render-8949] check ${fieldName} failed:`, err);
    }
  };

  // Header (name + SSN) on each page
  setText(headerNameField(1), taxpayerName);
  setText(headerSsnField(1), taxpayerSsn);
  setText(headerNameField(2), taxpayerName);
  setText(headerSsnField(2), taxpayerSsn);

  // Group rows by box
  type RowEntry = { trade: { description: string; dateAcquired: string; dateSold: string; proceeds: number; costBasis: number; adjustmentCode?: string; adjustmentAmount?: number; gainLoss: number }; box: string };
  const part1Rows: RowEntry[] = [];
  const part2Rows: RowEntry[] = [];
  const totalsByBox: Record<string, { proceeds: number; costBasis: number; adjustments: number; gainLoss: number }> = {};

  for (const line of evaluated.lines) {
    if (line.lineKind === "form-8949.row" && line.result.ok) {
      const trade = line.result.value;
      const entry: RowEntry = {
        trade: {
          description: trade.description,
          dateAcquired: trade.dateAcquired,
          dateSold: trade.dateSold,
          proceeds: trade.proceeds,
          costBasis: trade.costBasis,
          adjustmentCode: trade.adjustmentCode,
          adjustmentAmount: trade.adjustmentAmount,
          gainLoss: trade.gainLoss,
        },
        box: line.box,
      };
      // Note: starts-with on "partI" matches "partII" too. Use a dot
      // separator to disambiguate.
      if (line.box.startsWith("partI.")) part1Rows.push(entry);
      else if (line.box.startsWith("partII.")) part2Rows.push(entry);
    }
    if (line.lineKind === "form-8949.totals" && line.result.ok) {
      const t = line.result.value;
      totalsByBox[line.box] = {
        proceeds: t.totalProceeds,
        costBasis: t.totalCostBasis,
        adjustments: t.totalAdjustments,
        gainLoss: t.totalGainLoss,
      };
    }
  }

  // Page 1 (Part I) — check the appropriate boxes for any Part I trades
  const part1BoxesUsed = new Set(part1Rows.map((r) => r.box));
  for (const box of part1BoxesUsed) {
    const idx = PART1_BOX_TO_INDEX[box];
    if (idx !== undefined) {
      check(checkboxFieldName(1, idx));
      linesPopulated++;
    }
  }

  // Fill Part I rows (currently support up to 11 — same as the form)
  part1Rows.slice(0, 11).forEach((r, i) => {
    setText(rowFieldName(1, i, 0), r.trade.description);
    setText(rowFieldName(1, i, 1), r.trade.dateAcquired);
    setText(rowFieldName(1, i, 2), r.trade.dateSold);
    setText(rowFieldName(1, i, 3), fmtMoney(r.trade.proceeds));
    setText(rowFieldName(1, i, 4), fmtMoney(r.trade.costBasis));
    setText(rowFieldName(1, i, 5), r.trade.adjustmentCode ?? "");
    setText(rowFieldName(1, i, 6), fmtMoney(r.trade.adjustmentAmount));
    setText(rowFieldName(1, i, 7), fmtMoney(r.trade.gainLoss));
    linesPopulated++;
  });

  // Part I totals row (Line 2)
  // Sum across all Part I boxes for the displayed totals.
  const part1Totals = sumTotals(["partI.boxA", "partI.boxB", "partI.boxC"], totalsByBox);
  if (part1Totals) {
    setText(totalsFieldName(1, 0), fmtMoney(part1Totals.proceeds));   // (d)
    setText(totalsFieldName(1, 1), fmtMoney(part1Totals.costBasis));  // (e)
    // (f) is blank (adjustment code total — n/a)
    setText(totalsFieldName(1, 3), fmtMoney(part1Totals.adjustments)); // (g)
    setText(totalsFieldName(1, 4), fmtMoney(part1Totals.gainLoss));    // (h)
    linesPopulated++;
  }

  // Page 2 (Part II) — same pattern
  const part2BoxesUsed = new Set(part2Rows.map((r) => r.box));
  for (const box of part2BoxesUsed) {
    const idx = PART2_BOX_TO_INDEX[box];
    if (idx !== undefined) {
      check(checkboxFieldName(2, idx));
      linesPopulated++;
    }
  }

  part2Rows.slice(0, 11).forEach((r, i) => {
    setText(rowFieldName(2, i, 0), r.trade.description);
    setText(rowFieldName(2, i, 1), r.trade.dateAcquired);
    setText(rowFieldName(2, i, 2), r.trade.dateSold);
    setText(rowFieldName(2, i, 3), fmtMoney(r.trade.proceeds));
    setText(rowFieldName(2, i, 4), fmtMoney(r.trade.costBasis));
    setText(rowFieldName(2, i, 5), r.trade.adjustmentCode ?? "");
    setText(rowFieldName(2, i, 6), fmtMoney(r.trade.adjustmentAmount));
    setText(rowFieldName(2, i, 7), fmtMoney(r.trade.gainLoss));
    linesPopulated++;
  });

  const part2Totals = sumTotals(["partII.boxD", "partII.boxE", "partII.boxF"], totalsByBox);
  if (part2Totals) {
    setText(totalsFieldName(2, 0), fmtMoney(part2Totals.proceeds));
    setText(totalsFieldName(2, 1), fmtMoney(part2Totals.costBasis));
    setText(totalsFieldName(2, 3), fmtMoney(part2Totals.adjustments));
    setText(totalsFieldName(2, 4), fmtMoney(part2Totals.gainLoss));
    linesPopulated++;
  }

  form.flatten();
  const bytes = await pdf.save();
  return { bytes, linesPopulated };
}

function sumTotals(
  boxes: string[],
  by: Record<string, { proceeds: number; costBasis: number; adjustments: number; gainLoss: number }>,
): { proceeds: number; costBasis: number; adjustments: number; gainLoss: number } | null {
  const present = boxes.filter((b) => by[b] !== undefined);
  if (present.length === 0) return null;
  return present.reduce(
    (acc, b) => {
      const t = by[b];
      acc.proceeds += t.proceeds;
      acc.costBasis += t.costBasis;
      acc.adjustments += t.adjustments;
      acc.gainLoss += t.gainLoss;
      return acc;
    },
    { proceeds: 0, costBasis: 0, adjustments: 0, gainLoss: 0 },
  );
}
