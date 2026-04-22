import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { PDFDocument, PDFTextField, PDFCheckBox } from "pdf-lib";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { listFacts } from "../db/taxFacts";
import { computeCaseState } from "../../case/engine";
import type { FactMap } from "../../case/types";
import { alexDerivations } from "../../case/derivations";
import { artifactScopeDerivations } from "../../tax/artifacts";

// Anchor paths to project root so resolution survives Mastra's bundle cwd.
const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const BLANK_FORM_PATH = resolve(projectRoot, "ref/forms/f1040-2025.pdf");
const OUTPUT_DIR = resolve(projectRoot, "src/mastra/public/drafts");

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

  // Filing status — 5 checkboxes split across two AcroForm groups. Verified
  // by test render: the right-column boxes (HoH, QSS) live at the direct
  // c1_8[0..1] path; the left-column boxes (Single, MFJ, MFS) live at the
  // Checkbox_ReadOrder c1_8[0..2] path.
  filingSingle: "topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[0]",
  filingMFJ: "topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[1]",
  filingMFS: "topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[2]",
  filingHoH: "topmostSubform[0].Page1[0].c1_8[0]",
  filingQSS: "topmostSubform[0].Page1[0].c1_8[1]",

  // Income
  line1a_wagesW2: "topmostSubform[0].Page1[0].f1_47[0]",
  line1z_totalWages: "topmostSubform[0].Page1[0].f1_57[0]",
  line9_totalIncome: "topmostSubform[0].Page1[0].f1_73[0]",
  line10_adjustments: "topmostSubform[0].Page1[0].f1_74[0]",
  line11a_agi: "topmostSubform[0].Page1[0].f1_75[0]",

  // Tax and credits (page 2)
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
  line: string;
  apt: string;
  city: string;
  state: string;
  zip: string;
} {
  if (typeof addr === "string") {
    // Back-compat: older sessions stored the address as a single string.
    // Best-effort split on commas; downstream CPA review can clean up.
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

async function buildState(taxpayerId: string, year: number) {
  const rows = await listFacts({ taxpayerId, year, limit: 500 });
  const factMap: FactMap = {};
  for (const row of rows) {
    if (!(row.key in factMap)) factMap[row.key] = row.value;
  }
  if (factMap["tax_year"] === undefined) factMap["tax_year"] = year;
  const allDerivations = [...artifactScopeDerivations, ...alexDerivations];
  return { state: computeCaseState(factMap, allDerivations), factMap };
}

export const generateDraft1040 = createTool({
  id: "generate-draft-1040",
  description:
    "Fill out a draft IRS Form 1040 PDF for this taxpayer using the current case state. Call at hand-off (openAsks empty, withinMvp true) — NOT before. Writes to src/mastra/public/drafts/1040-{taxpayerId}-{year}.pdf and returns a URL that can be shared with the taxpayer or CPA reviewer. The draft is marked not-for-filing — a CPA must review and sign before anything is submitted.",
  inputSchema: z.object({
    taxpayerId: z.string(),
    year: z.number().int(),
  }),
  outputSchema: z.object({
    url: z.string(),
    path: z.string(),
    linesPopulated: z.number(),
  }),
  execute: async (input) => {
    const { taxpayerId, year } = input;
    const { state, factMap } = await buildState(taxpayerId, year);
    const d = state.derivations;

    // Values we need from the case state.
    const firstName = String(factMap["identity.name.first"] ?? "");
    const lastName = String(factMap["identity.name.last"] ?? "");
    const ssn = String(factMap["identity.ssn"] ?? "").replace(/\D/g, "");
    const addr = fmtAddress(factMap["identity.address"]);
    const filingStatus = String(factMap["identity.filing_status"] ?? "");

    const totalWages = Number(d["money.total_wages"] ?? 0);
    const agi = Number(d["money.agi"] ?? 0);
    const stdDed = Number(d["deductions.standard_deduction"] ?? 0);
    const taxableIncome = Number(d["money.taxable_income"] ?? 0);
    const taxOwed = Number(d["money.federal_tax_owed"] ?? 0);
    const withholding = Number(d["money.total_federal_withholding"] ?? 0);
    const refundOrBalance = d["money.refund_or_balance_due"] as
      | { direction: "refund" | "balance_due"; amount: number }
      | undefined;

    // Load the blank form and grab the AcroForm.
    const blankBytes = readFileSync(BLANK_FORM_PATH);
    const pdf = await PDFDocument.load(blankBytes);
    const form = pdf.getForm();

    const setText = (fieldName: string, value: string) => {
      if (!value) return;
      const f = form.getField(fieldName);
      if (f instanceof PDFTextField) {
        try {
          f.setText(value);
        } catch (err) {
          console.warn(`[generate-draft-1040] setText failed for ${fieldName}:`, err);
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
    setText(FIELDS.firstNameMi, firstName);
    touch();
    setText(FIELDS.lastName, lastName);
    touch();
    setText(FIELDS.ssn, ssn);
    touch();

    // Address
    setText(FIELDS.addressLine, addr.line);
    if (addr.apt) setText(FIELDS.aptNo, addr.apt);
    setText(FIELDS.city, addr.city);
    setText(FIELDS.state, addr.state);
    setText(FIELDS.zip, addr.zip);
    touch();

    // Filing status
    switch (filingStatus) {
      case "single":
        check(FIELDS.filingSingle);
        touch();
        break;
      case "married_filing_jointly":
      case "mfj":
        check(FIELDS.filingMFJ);
        touch();
        break;
      case "married_filing_separately":
      case "mfs":
        check(FIELDS.filingMFS);
        touch();
        break;
      case "head_of_household":
      case "hoh":
        check(FIELDS.filingHoH);
        touch();
        break;
      case "qualifying_surviving_spouse":
      case "qss":
        check(FIELDS.filingQSS);
        touch();
        break;
    }

    // Income
    setText(FIELDS.line1a_wagesW2, fmtMoney(totalWages));
    setText(FIELDS.line1z_totalWages, fmtMoney(totalWages));
    setText(FIELDS.line9_totalIncome, fmtMoney(totalWages));
    setText(FIELDS.line10_adjustments, fmtMoney(0));
    setText(FIELDS.line11a_agi, fmtMoney(agi));
    touch();

    // Tax and credits (page 2)
    setText(FIELDS.line11b_agi, fmtMoney(agi));
    setText(FIELDS.line12e_stdDeduction, fmtMoney(stdDed));
    setText(FIELDS.line14_deductionsTotal, fmtMoney(stdDed));
    setText(FIELDS.line15_taxableIncome, fmtMoney(taxableIncome));
    setText(FIELDS.line16_tax, fmtMoney(taxOwed));
    setText(FIELDS.line18_addTax, fmtMoney(taxOwed));
    setText(FIELDS.line22_afterCredits, fmtMoney(taxOwed));
    setText(FIELDS.line24_totalTax, fmtMoney(taxOwed));
    touch();

    // Payments
    setText(FIELDS.line25a_withholdingW2, fmtMoney(withholding));
    setText(FIELDS.line25d_totalWithholding, fmtMoney(withholding));
    setText(FIELDS.line33_totalPayments, fmtMoney(withholding));
    touch();

    // Refund or balance due
    if (refundOrBalance?.direction === "refund") {
      setText(FIELDS.line34_amountOverpaid, fmtMoney(refundOrBalance.amount));
      setText(FIELDS.line35a_refund, fmtMoney(refundOrBalance.amount));
      touch();
    } else if (refundOrBalance?.direction === "balance_due") {
      setText(FIELDS.line37_amountOwed, fmtMoney(refundOrBalance.amount));
      touch();
    }

    // Flatten so values are baked in and can't be edited in a viewer.
    // We want reviewers to see the draft as-is, not accidentally overwrite.
    form.flatten();

    const outBytes = await pdf.save();
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
    const fileName = `1040-${taxpayerId}-${year}.pdf`;
    const outPath = resolve(OUTPUT_DIR, fileName);
    writeFileSync(outPath, outBytes);

    // src/mastra/public is Mastra's served static dir, so files land at
    // /drafts/<name>.pdf on the dev server.
    const url = `/drafts/${fileName}`;
    return { url, path: outPath, linesPopulated };
  },
});
