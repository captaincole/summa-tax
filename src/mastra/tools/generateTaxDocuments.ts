import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { PDFDocument, PDFTextField, PDFCheckBox } from "pdf-lib";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot } from "../paths";
import { listFacts } from "../db/taxFacts";
import { listDecisions } from "../db/aiDecisions";
import {
  makeDecisionsView,
  makeFactsView,
  type BaseLine,
  type DerivationContext,
  type EvaluatedForm,
} from "../forms/types";
import { evaluateForm8949 } from "../forms/form8949";
import { evaluateScheduleD } from "../forms/scheduleD";
import {
  evaluateForm1040,
  type Form1040LineNumber,
  type Form1040NumericLine,
} from "../forms/form1040";
import { evaluateForm540, type Form540LineNumber } from "../forms/form540";
import { renderForm8949Pdf } from "../forms/render/form8949Pdf";
import { renderScheduleDPdf } from "../forms/render/scheduleDPdf";
import { renderForm540Pdf } from "../forms/render/form540Pdf";

const BLANK_FORM_PATH = resolve(projectRoot, "ref/forms/f1040-2025.pdf");
const BLANK_8949_PATH = resolve(projectRoot, "ref/forms/f8949.pdf");
const BLANK_SCHEDULE_D_PATH = resolve(projectRoot, "ref/forms/f1040sd.pdf");
const BLANK_540_PATH = resolve(projectRoot, "ref/forms/state/ca/2025-540.pdf");
// Must match the directory src/mastra/index.ts serves /drafts/:filename from
// — in prod that's the Render persistent disk at $DRAFTS_DIR=/data/drafts;
// in dev it falls back to src/mastra/public/drafts.
const OUTPUT_DIR = process.env.DRAFTS_DIR
  ? resolve(process.env.DRAFTS_DIR)
  : resolve(projectRoot, "src/mastra/public/drafts");

// Field-name → 1040 line mapping for the 2025 form (extracted by inspection
// of the AcroForm in ref/forms/f1040-2025.pdf). Stable across an entire
// tax year's PDF; will need re-mapping when IRS publishes 2026's form.
const FIELDS = {
  // Primary identity
  firstNameMi: "topmostSubform[0].Page1[0].f1_14[0]",
  lastName: "topmostSubform[0].Page1[0].f1_15[0]",
  ssn: "topmostSubform[0].Page1[0].f1_16[0]",

  // Home address
  addressLine: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_20[0]",
  aptNo: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_21[0]",
  city: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_22[0]",
  state: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_23[0]",
  zip: "topmostSubform[0].Page1[0].Address_ReadOrder[0].f1_24[0]",

  // Filing status — 5 checkboxes split across two AcroForm groups.
  filingSingle: "topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[0]",
  filingMFJ: "topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[1]",
  filingMFS: "topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[2]",
  filingHoH: "topmostSubform[0].Page1[0].c1_8[0]",
  filingQSS: "topmostSubform[0].Page1[0].c1_8[1]",

  // Income (Page 1) — field IDs verified via scripts/labelPdfFields.ts on
  // ref/forms/f1040-2025.pdf and visual inspection of the labeled output.
  line1a_wagesW2: "topmostSubform[0].Page1[0].f1_47[0]",
  line1z_totalWages: "topmostSubform[0].Page1[0].f1_57[0]",
  line3a_qualDivs: "topmostSubform[0].Page1[0].f1_60[0]",   // small "3a" box on left
  line3b_ordDivs: "topmostSubform[0].Page1[0].f1_61[0]",    // right income column
  line7_capitalGain: "topmostSubform[0].Page1[0].f1_70[0]", // capital gain from Schedule D
  line9_totalIncome: "topmostSubform[0].Page1[0].f1_73[0]",
  line10_adjustments: "topmostSubform[0].Page1[0].f1_74[0]",
  line11a_agi: "topmostSubform[0].Page1[0].f1_75[0]",

  // Tax and credits (Page 2)
  line11b_agi: "topmostSubform[0].Page2[0].f2_01[0]",
  line12e_stdDeduction: "topmostSubform[0].Page2[0].f2_02[0]",
  line14_deductionsTotal: "topmostSubform[0].Page2[0].f2_05[0]",
  line15_taxableIncome: "topmostSubform[0].Page2[0].f2_06[0]",
  line16_tax: "topmostSubform[0].Page2[0].f2_08[0]",
  line18_addTax: "topmostSubform[0].Page2[0].f2_10[0]",
  line22_afterCredits: "topmostSubform[0].Page2[0].f2_14[0]",
  line24_totalTax: "topmostSubform[0].Page2[0].f2_16[0]",
  line25a_withholdingW2: "topmostSubform[0].Page2[0].f2_17[0]",
  line25d_totalWithholding: "topmostSubform[0].Page2[0].f2_20[0]",
  line33_totalPayments: "topmostSubform[0].Page2[0].f2_29[0]",
  line34_amountOverpaid: "topmostSubform[0].Page2[0].f2_30[0]",
  line35a_refund: "topmostSubform[0].Page2[0].f2_31[0]",
  line37_amountOwed: "topmostSubform[0].Page2[0].f2_35[0]",
};

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n === 0) return "0";
  return Math.round(n).toString();
}

function fmtAddress(addr: unknown): {
  line: string; apt: string; city: string; state: string; zip: string;
} {
  if (typeof addr === "string") {
    return { line: addr, apt: "", city: "", state: "", zip: "" };
  }
  if (addr && typeof addr === "object") {
    const a = addr as Record<string, unknown>;
    return {
      line: String(a.line1 ?? a.street ?? ""),
      apt: String(a.line2 ?? a.apt ?? ""),
      city: String(a.city ?? ""),
      state: String(a.state ?? ""),
      zip: String(a.zip ?? a.zipCode ?? ""),
    };
  }
  return { line: "", apt: "", city: "", state: "", zip: "" };
}

// Look up a numeric Form 1040 line value from the EvaluatedForm1040.
function f1040LineValue(
  lines: readonly Form1040NumericLine[],
  number: Form1040LineNumber,
): number | null {
  const line = lines.find((l) => l.lineNumber === number);
  if (!line || !line.result.ok) return null;
  return line.result.value;
}

export const generateTaxDocuments = createTool({
  id: "generate-tax-documents",
  description:
    "Run the four-form engine (Form 8949 → Schedule D → Form 1040 → CA Form 540) for this taxpayer and render every applicable form as a filled-out PDF. Writes Form 1040, Form 8949, Schedule D, and CA Form 540 PDFs (whichever the engine says are required) plus a JSON sidecar with all four forms' line values. Call at hand-off (no pending decisions, all required forms computed). Marked draft / not-for-filing — a CPA reviews before submission.",
  inputSchema: z.object({
    taxpayerId: z.string(),
    year: z.number().int(),
  }),
  outputSchema: z.object({
    url: z.string(),
    form8949Url: z.string().nullable(),
    scheduleDUrl: z.string().nullable(),
    form540Url: z.string().nullable(),
    sidecarUrl: z.string(),
    path: z.string(),
    linesPopulated: z.number(),
    federalRefundOrOwed: z.object({
      kind: z.enum(["refund", "owed", "balanced"]),
      amount: z.number(),
    }),
    stateRefundOrOwed: z.object({
      kind: z.enum(["refund", "owed", "balanced"]),
      amount: z.number(),
    }),
  }),
  execute: async (input) => {
    const { taxpayerId, year } = input;

    // ─── Read state from DB ───
    const [factRows, decisionRows] = await Promise.all([
      listFacts({ taxpayerId, year, limit: 500 }),
      listDecisions({ taxpayerId, year, limit: 500 }),
    ]);

    // Identity facts: written by ingest-w2-structured (auto-extracted from
    // W-2 boxes a/e/f) or by record-tax-fact when no W-2 is involved.
    const factMap = new Map<string, unknown>();
    for (const r of factRows) if (!factMap.has(r.key)) factMap.set(r.key, r.value);
    const firstName = String(factMap.get("identity.name.first") ?? "");
    const lastName = String(factMap.get("identity.name.last") ?? "");
    const ssn = String(factMap.get("identity.ssn") ?? "").replace(/\D/g, "");
    const dob = String(factMap.get("identity.dob") ?? "");
    const addr = fmtAddress(factMap.get("identity.address"));

    // Filing status now lives as an ai_decision.
    const filingStatusDecision = decisionRows.find(
      (d) => d.decisionKey === "decisions.scope.filing_status",
    );
    const filingStatus = filingStatusDecision
      ? String(filingStatusDecision.decision)
      : "";

    // ─── Run the form engine ───
    const ctx: DerivationContext = {
      taxYear: year,
      facts: makeFactsView(factRows),
      decisions: makeDecisionsView(decisionRows),
    };
    const form8949 = evaluateForm8949(ctx);
    const scheduleD = evaluateScheduleD(ctx, form8949);
    const form1040 = evaluateForm1040(ctx, scheduleD);
    const form540 = evaluateForm540(ctx, form1040);

    // ─── Pull 1040 line values ───
    const lv = (n: Form1040LineNumber) => f1040LineValue(form1040.lines, n);

    const totalWages = lv("1a") ?? 0;
    const totalWages_1z = lv("1z") ?? 0;
    const qualDivs = lv("3a") ?? 0;
    const ordDivs = lv("3b") ?? 0;
    const capitalGain = lv("7") ?? 0;
    const totalIncome = lv("9") ?? 0;
    const adjustments = lv("10") ?? 0;
    const agi = lv("11") ?? 0;
    const stdDed = lv("12") ?? 0;
    const deductionsTotal = lv("14") ?? 0;
    const taxableIncome = lv("15") ?? 0;
    const tax = lv("16") ?? 0;
    const totalTax = lv("24") ?? 0;
    const withholding = lv("25a") ?? 0;
    const totalPayments = lv("33") ?? 0;
    const refund = lv("34");  // null if balance due
    const owed = lv("37");    // null if refund

    // ─── Fill the 1040 PDF ───
    const blankBytes = readFileSync(BLANK_FORM_PATH);
    const pdf = await PDFDocument.load(blankBytes);
    const form = pdf.getForm();

    const setText = (fieldName: string, value: string) => {
      if (!value) return;
      const f = form.getField(fieldName);
      if (f instanceof PDFTextField) {
        try { f.setText(value); } catch (err) {
          console.warn(`[generate-tax-documents] setText failed for ${fieldName}:`, err);
        }
      }
    };
    const check = (fieldName: string) => {
      const f = form.getField(fieldName);
      if (f instanceof PDFCheckBox) f.check();
    };

    let linesPopulated = 0;
    const touch = () => linesPopulated++;

    // Identity
    setText(FIELDS.firstNameMi, firstName); touch();
    setText(FIELDS.lastName, lastName); touch();
    setText(FIELDS.ssn, ssn); touch();

    // Address
    setText(FIELDS.addressLine, addr.line);
    if (addr.apt) setText(FIELDS.aptNo, addr.apt);
    setText(FIELDS.city, addr.city);
    setText(FIELDS.state, addr.state);
    setText(FIELDS.zip, addr.zip);
    touch();

    // Filing status
    switch (filingStatus) {
      case "single": check(FIELDS.filingSingle); touch(); break;
      case "married_filing_jointly":
      case "mfj": check(FIELDS.filingMFJ); touch(); break;
      case "married_filing_separately":
      case "mfs": check(FIELDS.filingMFS); touch(); break;
      case "head_of_household":
      case "hoh": check(FIELDS.filingHoH); touch(); break;
      case "qualifying_surviving_spouse":
      case "qss": check(FIELDS.filingQSS); touch(); break;
    }

    // Income (Page 1)
    setText(FIELDS.line1a_wagesW2, fmtMoney(totalWages));
    setText(FIELDS.line1z_totalWages, fmtMoney(totalWages_1z));
    setText(FIELDS.line3a_qualDivs, fmtMoney(qualDivs));
    setText(FIELDS.line3b_ordDivs, fmtMoney(ordDivs));
    setText(FIELDS.line7_capitalGain, fmtMoney(capitalGain));
    setText(FIELDS.line9_totalIncome, fmtMoney(totalIncome));
    setText(FIELDS.line10_adjustments, fmtMoney(adjustments));
    setText(FIELDS.line11a_agi, fmtMoney(agi));
    touch();

    // Tax and credits (Page 2)
    setText(FIELDS.line11b_agi, fmtMoney(agi));
    setText(FIELDS.line12e_stdDeduction, fmtMoney(stdDed));
    setText(FIELDS.line14_deductionsTotal, fmtMoney(deductionsTotal));
    setText(FIELDS.line15_taxableIncome, fmtMoney(taxableIncome));
    setText(FIELDS.line16_tax, fmtMoney(tax));
    setText(FIELDS.line18_addTax, fmtMoney(tax));
    setText(FIELDS.line22_afterCredits, fmtMoney(tax));
    setText(FIELDS.line24_totalTax, fmtMoney(totalTax));
    touch();

    // Payments
    setText(FIELDS.line25a_withholdingW2, fmtMoney(withholding));
    setText(FIELDS.line25d_totalWithholding, fmtMoney(withholding));
    setText(FIELDS.line33_totalPayments, fmtMoney(totalPayments));
    touch();

    // Refund or balance due
    if (refund !== null && refund > 0) {
      setText(FIELDS.line34_amountOverpaid, fmtMoney(refund));
      setText(FIELDS.line35a_refund, fmtMoney(refund));
      touch();
    } else if (owed !== null && owed > 0) {
      setText(FIELDS.line37_amountOwed, fmtMoney(owed));
      touch();
    }

    form.flatten();

    const outBytes = await pdf.save();
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
    const fileName = `1040-${taxpayerId}-${year}.pdf`;
    const outPath = resolve(OUTPUT_DIR, fileName);
    writeFileSync(outPath, outBytes);
    const url = `/drafts/${fileName}`;

    // ─── Render Form 8949 + Schedule D PDFs (when their forms apply) ───
    const taxpayerName = `${firstName} ${lastName}`.trim();

    let form8949Url: string | null = null;
    if (form8949.mustFile.ok && form8949.mustFile.value) {
      try {
        const blank8949 = readFileSync(BLANK_8949_PATH);
        const { bytes } = await renderForm8949Pdf({
          templateBytes: blank8949,
          evaluated: form8949,
          taxpayerName,
          taxpayerSsn: ssn,
        });
        const f8949Name = `8949-${taxpayerId}-${year}.pdf`;
        writeFileSync(resolve(OUTPUT_DIR, f8949Name), bytes);
        form8949Url = `/drafts/${f8949Name}`;
      } catch (err) {
        console.warn("[generate-tax-documents] Form 8949 render failed:", err);
      }
    }

    let scheduleDUrl: string | null = null;
    if (scheduleD.mustFile.ok && scheduleD.mustFile.value) {
      try {
        const blankSd = readFileSync(BLANK_SCHEDULE_D_PATH);
        const { bytes } = await renderScheduleDPdf({
          templateBytes: blankSd,
          evaluated: scheduleD,
          taxpayerName,
          taxpayerSsn: ssn,
        });
        const sdName = `schedule-d-${taxpayerId}-${year}.pdf`;
        writeFileSync(resolve(OUTPUT_DIR, sdName), bytes);
        scheduleDUrl = `/drafts/${sdName}`;
      } catch (err) {
        console.warn("[generate-tax-documents] Schedule D render failed:", err);
      }
    }

    let form540Url: string | null = null;
    if (form540.mustFile.ok && form540.mustFile.value) {
      try {
        const blank540 = readFileSync(BLANK_540_PATH);
        const { bytes } = await renderForm540Pdf({
          templateBytes: blank540,
          evaluated: form540,
          taxpayerFirstName: firstName,
          taxpayerLastName: lastName,
          taxpayerSsn: ssn,
          taxpayerDob: dob,
          taxpayerStreetAddress: addr.line,
          taxpayerCity: addr.city,
          taxpayerZip: addr.zip,
          filingStatus,
        });
        const f540Name = `540-${taxpayerId}-${year}.pdf`;
        writeFileSync(resolve(OUTPUT_DIR, f540Name), bytes);
        form540Url = `/drafts/${f540Name}`;
      } catch (err) {
        console.warn("[generate-tax-documents] CA 540 render failed:", err);
      }
    }

    // ─── JSON sidecar with all four forms' line values ───
    const sidecar = {
      taxpayerId,
      year,
      generatedAt: new Date().toISOString(),
      forms: {
        "form-8949": serializeForm(form8949),
        "schedule-d": serializeForm(scheduleD),
        "form-1040": serializeForm(form1040),
        "form-540": serializeForm(form540),
      },
    };
    const sidecarFileName = `forms-${taxpayerId}-${year}.json`;
    const sidecarPath = resolve(OUTPUT_DIR, sidecarFileName);
    writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));
    const sidecarUrl = `/drafts/${sidecarFileName}`;

    // ─── Refund / owed summaries for the tool response ───
    const federalRefundOrOwed = (() => {
      if (refund !== null && refund > 0) return { kind: "refund" as const, amount: refund };
      if (owed !== null && owed > 0) return { kind: "owed" as const, amount: owed };
      return { kind: "balanced" as const, amount: 0 };
    })();

    const stateRefund = f540LineValue(form540, "97");
    const stateOwed = f540LineValue(form540, "100");
    const stateRefundOrOwed = (() => {
      if (stateRefund !== null && stateRefund > 0) return { kind: "refund" as const, amount: stateRefund };
      if (stateOwed !== null && stateOwed > 0) return { kind: "owed" as const, amount: stateOwed };
      return { kind: "balanced" as const, amount: 0 };
    })();

    return {
      url,
      form8949Url,
      scheduleDUrl,
      form540Url,
      sidecarUrl,
      path: outPath,
      linesPopulated,
      federalRefundOrOwed,
      stateRefundOrOwed,
    };
  },
});

// ─── Helpers for sidecar serialization ───────────────────────────────────

function serializeForm<L extends BaseLine>(form: EvaluatedForm<L>) {
  return {
    formId: form.formId,
    jurisdiction: form.jurisdiction,
    title: form.title,
    mustFile: form.mustFile,
    lines: form.lines.map((l) => ({ ...l })),
  };
}

function f540LineValue<L extends BaseLine & { lineNumber: Form540LineNumber }>(
  form540: EvaluatedForm<L>,
  number: Form540LineNumber,
): number | null {
  const line = form540.lines.find((l) => l.lineNumber === number);
  if (!line || !line.result.ok) return null;
  const v = line.result.value;
  return typeof v === "number" ? v : null;
}
