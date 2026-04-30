// Render Schedule D (Capital Gains and Losses) into the IRS PDF template
// at ref/forms/f1040sd.pdf. Driven by EvaluatedScheduleD.
//
// Field-name conventions (extracted via scripts/inspectPdfFields.ts):
//   Part I aggregate rows (1a, 1b, 2, 3) — 4 columns each (d, e, g, h):
//     Row1a: f1_3, f1_4, f1_5, f1_6
//     Row1b: f1_7, f1_8, f1_9, f1_10
//     Row2:  f1_11, f1_12, f1_13, f1_14
//     Row3:  f1_15, f1_16, f1_17, f1_18
//   Part I single-value lines:
//     Line 4: f1_19  Line 5: f1_20  Line 6: f1_21  Line 7: f1_22
//   Part II aggregate rows (8a, 8b, 9, 10) — 4 columns each:
//     Row8a: f1_23, f1_24, f1_25, f1_26
//     Row8b: f1_27, f1_28, f1_29, f1_30
//     Row9:  f1_31, f1_32, f1_33, f1_34
//     Row10: f1_35, f1_36, f1_37, f1_38
//   Part II single-value lines:
//     Line 11: f1_39  Line 12: f1_40  Line 13: f1_41  Line 14: f1_42  Line 15: f1_43
//   Part III (Page 2):
//     Line 16: f2_1
//   Identity:
//     Name: Page1 f1_1   SSN: Page1 f1_2

import { PDFDocument, PDFTextField } from "pdf-lib";
import type { EvaluatedScheduleD } from "../scheduleD";

interface ScheduleDRenderInput {
  templateBytes: Uint8Array;
  evaluated: EvaluatedScheduleD;
  taxpayerName: string;
  taxpayerSsn: string;
}

const fmtMoney = (n: number | undefined): string => {
  if (n === undefined || n === null) return "";
  if (n === 0) return "0";
  return Math.round(n).toString();
};

// Aggregate-row field-base lookup for the 4-column rows.
const AGG_ROW_BASE: Record<string, { row: string; firstField: number; page: 1 }> = {
  "1a": { row: "Row1a", firstField: 3,  page: 1 },
  "1b": { row: "Row1b", firstField: 7,  page: 1 },
  "2":  { row: "Row2",  firstField: 11, page: 1 },
  "3":  { row: "Row3",  firstField: 15, page: 1 },
  "8a": { row: "Row8a", firstField: 23, page: 1 },
  "8b": { row: "Row8b", firstField: 27, page: 1 },
  "9":  { row: "Row9",  firstField: 31, page: 1 },
  "10": { row: "Row10", firstField: 35, page: 1 },
};

// Single-value lines that don't live inside a Table_Part* group.
const SINGLE_LINE_FIELD: Record<string, { page: 1 | 2; field: string }> = {
  "4":  { page: 1, field: "f1_19" },
  "5":  { page: 1, field: "f1_20" },
  "6":  { page: 1, field: "f1_21" },
  "7":  { page: 1, field: "f1_22" },
  "11": { page: 1, field: "f1_39" },
  "12": { page: 1, field: "f1_40" },
  "13": { page: 1, field: "f1_41" },
  "14": { page: 1, field: "f1_42" },
  "15": { page: 1, field: "f1_43" },
  "16": { page: 2, field: "f2_1" },
};

const aggFieldName = (lineNumber: keyof typeof AGG_ROW_BASE, colIdx: number): string => {
  const { row, firstField } = AGG_ROW_BASE[lineNumber];
  // Schedule D Page 1 table fields use single-digit f1_3..f1_38 numbering
  // (note: no leading zero like Form 8949).
  const partTable = lineNumber.includes("8") || ["9", "10"].includes(String(lineNumber))
    ? "Table_PartII"
    : "Table_PartI";
  return `topmostSubform[0].Page1[0].${partTable}[0].${row}[0].f1_${firstField + colIdx}[0]`;
};

const singleFieldName = (lineNumber: keyof typeof SINGLE_LINE_FIELD): string => {
  const { page, field } = SINGLE_LINE_FIELD[lineNumber];
  return `topmostSubform[0].Page${page}[0].${field}[0]`;
};

export async function renderScheduleDPdf(
  input: ScheduleDRenderInput,
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
      console.warn(`[render-schedule-d] setText ${fieldName} failed:`, err);
    }
  };

  // Identity
  setText("topmostSubform[0].Page1[0].f1_1[0]", taxpayerName);
  setText("topmostSubform[0].Page1[0].f1_2[0]", taxpayerSsn);

  for (const line of evaluated.lines) {
    // Narrow on lineKind first, then on result.ok — gives us the right
    // value type inside each branch without casts.
    if (line.lineKind === "schedule-d.aggregate") {
      if (!line.result.ok) continue;
      const lineNum = line.lineNumber;
      if (!(lineNum in AGG_ROW_BASE)) continue;
      const v = line.result.value;
      // 4 columns: (d) proceeds, (e) cost basis, (g) adjustments, (h) gain/loss
      setText(aggFieldName(lineNum as keyof typeof AGG_ROW_BASE, 0), fmtMoney(v.proceeds));
      setText(aggFieldName(lineNum as keyof typeof AGG_ROW_BASE, 1), fmtMoney(v.costBasis));
      setText(aggFieldName(lineNum as keyof typeof AGG_ROW_BASE, 2), fmtMoney(v.adjustments));
      setText(aggFieldName(lineNum as keyof typeof AGG_ROW_BASE, 3), fmtMoney(v.gainLoss));
      linesPopulated++;
    } else if (line.lineKind === "schedule-d.single") {
      if (!line.result.ok) continue;
      const lineNum = line.lineNumber;
      if (!(lineNum in SINGLE_LINE_FIELD)) continue;
      setText(singleFieldName(lineNum as keyof typeof SINGLE_LINE_FIELD), fmtMoney(line.result.value));
      linesPopulated++;
    }
  }

  form.flatten();
  const bytes = await pdf.save();
  return { bytes, linesPopulated };
}
