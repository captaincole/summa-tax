// Render CA Form 540 (California Resident Income Tax Return) into the FTB
// PDF template at ref/forms/state/ca/2025-540.pdf. Driven by EvaluatedForm540.
//
// Field-name conventions (extracted via scripts/labelPdfFields.ts and
// visual inspection of the rendered debug PDF):
//
// Identity (Side 1):
//   First name: 540_form_1003     Last name: 540_form_1005
//   SSN: 540_form_1007            Street address: 540_form_1015
//   City: 540_form_1018           ZIP: 540_form_1020
//   DOB: 540_form_1024
//   Filing status (radio): 540_form_1036 — options:
//     "1 . Single."
//     "2 . Married/R D P filing jointly..."
//     "3 . Married or R D P filing separately."
//     "4 . Head of household..."
//     "5 . Qualifying surviving spouse or R D P ."
//
// Income & deductions (Side 2):
//   Line 12 (state wages):              540_form_2018
//   Line 13 (federal AGI):              540_form_2019
//   Line 17 (CA AGI):                   540_form_2023
//   Line 18 (standard deduction):       540_form_2024
//   Line 19 (taxable income):           540_form_2025
//   Line 31 (tax):                      540_form_2030
//
// Other taxes & payments (Side 3):
//   Line 64 (total tax):                540_form_3010
//   Line 71 (CA withholding):           540_form_3011
//   Line 78 (total payments):           540_form_3018
//   Line 97 (overpaid / refund):        540_form_3027
//
// Tax due (Side 4):
//   Line 100 (tax due):                 540_form_4005

import { PDFDocument, PDFTextField, PDFRadioGroup } from "pdf-lib";
import type { EvaluatedForm540, Form540LineNumber } from "../form540";

interface Form540RenderInput {
  templateBytes: Uint8Array;
  evaluated: EvaluatedForm540;
  taxpayerFirstName: string;
  taxpayerLastName: string;
  taxpayerSsn: string;
  taxpayerDob?: string; // "MM/DD/YYYY" as printed on the form
  taxpayerStreetAddress?: string;
  taxpayerCity?: string;
  taxpayerZip?: string;
  filingStatus?: string; // "single" | "married_filing_jointly" | "married_filing_separately" | "head_of_household" | "qualifying_surviving_spouse"
}

const fmtMoney = (n: number | undefined): string => {
  if (n === undefined || n === null) return "";
  if (n === 0) return "0";
  return Math.round(n).toString();
};

// Each populated form-540 line maps to one PDF text field by ID.
const LINE_FIELD: Record<Form540LineNumber, string> = {
  "12":  "540_form_2018",
  "13":  "540_form_2019",
  "17":  "540_form_2023",
  "18":  "540_form_2024",
  "19":  "540_form_2025",
  "31":  "540_form_2030",
  "64":  "540_form_3010",
  "71":  "540_form_3011",
  "78":  "540_form_3018",
  "97":  "540_form_3027",
  "100": "540_form_4005",
};

// FTB filing-status radio options (match the label strings exactly).
const FILING_STATUS_OPTION: Record<string, string> = {
  single: "1 . Single.",
  married_filing_jointly:
    "2 . Married/R D P filing jointly (even if only one spouse / R D P had income). See instructions.",
  married_filing_separately: "3 . Married or R D P filing separately.",
  head_of_household: "4 . Head of household (with qualifying person). See instructions.",
  qualifying_surviving_spouse: "5 . Qualifying surviving spouse or R D P .",
};

export async function renderForm540Pdf(
  input: Form540RenderInput,
): Promise<{ bytes: Uint8Array; linesPopulated: number }> {
  const pdf = await PDFDocument.load(input.templateBytes);
  const form = pdf.getForm();
  let linesPopulated = 0;

  const setText = (fieldName: string, value: string) => {
    if (!value) return;
    try {
      const f = form.getField(fieldName);
      if (f instanceof PDFTextField) f.setText(value);
    } catch (err) {
      console.warn(`[render-540] setText ${fieldName} failed:`, err);
    }
  };

  // Identity block (Side 1)
  setText("540_form_1003", input.taxpayerFirstName);
  setText("540_form_1005", input.taxpayerLastName);
  setText("540_form_1007", input.taxpayerSsn);
  if (input.taxpayerStreetAddress) setText("540_form_1015", input.taxpayerStreetAddress);
  if (input.taxpayerCity) setText("540_form_1018", input.taxpayerCity);
  if (input.taxpayerZip) setText("540_form_1020", input.taxpayerZip);
  if (input.taxpayerDob) setText("540_form_1024", input.taxpayerDob);
  linesPopulated++;

  // Filing-status radio. FTB naming convention appends " RB" to radio
  // groups and " CB" to checkboxes (text fields have no suffix).
  if (input.filingStatus) {
    const option = FILING_STATUS_OPTION[input.filingStatus];
    if (option) {
      try {
        const radio = form.getField("540_form_1036 RB");
        if (radio instanceof PDFRadioGroup) {
          radio.select(option);
          linesPopulated++;
        }
      } catch (err) {
        console.warn(`[render-540] filing-status radio failed:`, err);
      }
    }
  }

  // Numeric lines from the evaluated form
  for (const line of input.evaluated.lines) {
    if (!line.result.ok) continue;
    const fieldName = LINE_FIELD[line.lineNumber];
    if (!fieldName) continue;
    setText(fieldName, fmtMoney(line.result.value));
    linesPopulated++;
  }

  form.flatten();
  const bytes = await pdf.save();
  return { bytes, linesPopulated };
}
