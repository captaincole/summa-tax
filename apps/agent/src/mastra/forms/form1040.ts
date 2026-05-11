// Form 1040 — U.S. Individual Income Tax Return
//
// Pulls W-2 wage data and 1099-DIV box totals from the fact catalog, takes
// Schedule D as a parameter for capital gains, applies the standard
// deduction (per filing-status decision), computes taxable income, and
// produces the tax owed / refund.
//
// Scope for the first iteration (Alejandro):
//   header       — first name, last name, SSN, address, filing status
//                  (modelled as fields so the Filing Status panel can show
//                  whether the renderer's top-of-form personal info is
//                  complete; the PDF layer continues to read raw identity
//                  facts directly, this is for the progress UI)
//   1a, 1z       — wages from W-2 box 1
//   3a, 3b       — qualified / ordinary dividends from 1099-DIV
//   7            — capital gain/(loss) from Schedule D line 16
//   9, 10, 11    — total income, adjustments, AGI
//   12, 13, 14   — standard deduction, QBI, sum
//   15           — taxable income
//   16           — tax computed via 2025 ordinary brackets [SIMPLIFIED]
//   23, 24       — other taxes (zero), total tax
//   25a          — federal withholding from W-2 box 2
//   33           — total payments
//   34 / 37      — refund or amount owed
//
// Known simplifications, called out so they're not surprises:
//   - Line 16 uses ordinary brackets only; the Qualified Dividends and
//     Capital Gain Tax Worksheet (preferential 0%/15%/20% on LTCG +
//     qualified divs) is NOT applied yet. For Alejandro this overstates
//     tax by ~$200. Add the worksheet when we have a scenario where the
//     preferential rate materially changes the bottom line.
//   - We don't yet emit lines 1b–1h, 2a/2b, 4a/4b, 5a/5b, 6a/6b/6c, 8 —
//     those carry data from sources we haven't ingested for Alejandro
//     (1099-INT, IRA distributions, social security, etc.).

import {
  ok,
  blocked,
  type BaseFormField,
  type Category,
  type DerivationContext,
  type DerivationResult,
  type EvaluatedForm,
} from "./types.js";
import type { EvaluatedScheduleD, ScheduleDSingleValueField } from "./scheduleD.js";
import { getDividendFacts, getW2Facts } from "../facts/index.js";

// ─── Field shapes ────────────────────────────────────────────────────────

export type Form1040LineNumber =
  | "1a" | "1z"
  | "3a" | "3b"
  | "7"
  | "9" | "10" | "11"
  | "12" | "13" | "14"
  | "15" | "16"
  | "23" | "24"
  | "25a"
  | "33"
  | "34" | "37";

export interface Form1040NumericField extends BaseFormField<number> {
  formFieldKind: "form-1040.numeric";
  lineNumber: Form1040LineNumber;
}

export interface Form1040TextField extends BaseFormField<string> {
  formFieldKind: "form-1040.text";
}

export interface Form1040SingleSelectField extends BaseFormField<string> {
  formFieldKind: "form-1040.single-select";
}

export type Form1040Field =
  | Form1040NumericField
  | Form1040TextField
  | Form1040SingleSelectField;

export type EvaluatedForm1040 = EvaluatedForm<Form1040Field>;

// Each numeric line maps to a Filing-Status-panel category. This is the
// only categorization the form needs to declare — the form engine's
// derivation graph already tells us whether a field is complete or blocked.
const NUMERIC_CATEGORY: Record<Form1040LineNumber, Category> = {
  "1a":  "income",
  "1z":  "income",
  "3a":  "income",
  "3b":  "income",
  "7":   "income",
  "9":   "income",
  "10":  "deductions_credits",
  "11":  "income",                // AGI — still an income aggregate
  "12":  "deductions_credits",
  "13":  "deductions_credits",
  "14":  "deductions_credits",
  "15":  "income",                // taxable income (income minus deductions)
  "16":  "deductions_credits",
  "23":  "deductions_credits",
  "24":  "deductions_credits",
  "25a": "deductions_credits",    // withholding is a payment against tax
  "33":  "deductions_credits",
  "34":  "deductions_credits",
  "37":  "deductions_credits",
};

// ─── 2025 Single filer constants ─────────────────────────────────────────
// Hardcoded for Alejandro's case. When more filing statuses come online,
// move these to a typed lookup keyed on filing-status decision.

const STANDARD_DEDUCTION_2025: Record<string, number> = {
  single: 15000,
  married_filing_jointly: 30000,
  married_filing_separately: 15000,
  head_of_household: 22500,
  qualifying_surviving_spouse: 30000,
};

// 2025 single brackets — used by the simplified ordinary tax calc.
// (lower, upper, rate). Upper of Infinity for the top bracket.
const ORDINARY_BRACKETS_2025_SINGLE: Array<[number, number, number]> = [
  [0,        11_925,  0.10],
  [11_925,   48_475,  0.12],
  [48_475,  103_350,  0.22],
  [103_350, 197_300,  0.24],
  [197_300, 250_525,  0.32],
  [250_525, 626_350,  0.35],
  [626_350, Infinity, 0.37],
];

const ordinaryTaxSingle = (taxable: number): number => {
  if (taxable <= 0) return 0;
  let tax = 0;
  for (const [lo, hi, rate] of ORDINARY_BRACKETS_2025_SINGLE) {
    if (taxable <= lo) break;
    const slice = Math.min(taxable, hi) - lo;
    tax += slice * rate;
  }
  return Math.round(tax * 100) / 100;
};

// ─── Evaluator ───────────────────────────────────────────────────────────

export function evaluateForm1040(
  ctx: DerivationContext,
  scheduleD: EvaluatedScheduleD,
): EvaluatedForm1040 {
  const fields: Form1040Field[] = [];

  const mustFile = mustFileForm1040(ctx);
  const baseForm: Omit<EvaluatedForm1040, "fields"> = {
    formId: "form-1040",
    jurisdiction: "federal",
    title: "U.S. Individual Income Tax Return",
    taxYear: ctx.taxYear,
    mustFile,
  };
  if (!mustFile.ok || !mustFile.value) {
    return { ...baseForm, fields };
  }

  // ─── Header — personal info + filing scope ───
  // These derive from identity facts and the filing_status decision. They
  // exist so the Filing Status panel knows whether the form's header is
  // complete; PDF rendering still reads raw facts directly.
  fields.push(
    textFieldFromFact(
      "form-1040.header.first_name",
      "First name",
      "personal_info",
      "identity.name.first",
      ctx,
    ),
  );
  fields.push(
    textFieldFromFact(
      "form-1040.header.last_name",
      "Last name",
      "personal_info",
      "identity.name.last",
      ctx,
    ),
  );
  fields.push(
    textFieldFromFact(
      "form-1040.header.ssn",
      "SSN",
      "personal_info",
      "identity.ssn",
      ctx,
    ),
  );
  fields.push(
    textFieldFromFact(
      "form-1040.header.address",
      "Home address",
      "personal_info",
      "identity.address",
      ctx,
    ),
  );
  fields.push(
    singleSelectFromDecision(
      "form-1040.header.filing_status",
      "Filing status",
      "filing_scope",
      "decisions.scope.filing_status",
      ctx,
    ),
  );

  // ─── Wages from W-2s ───
  const w2s = getW2Facts(ctx.facts);
  const totalBox1 = w2s.reduce((s, w) => s + (w.w2.box1 ?? 0), 0);
  const totalBox2 = w2s.reduce((s, w) => s + (w.w2.box2 ?? 0), 0);
  const w2FactKeys = w2s.map((w) => w.sourceFact.key);

  // Line 1a — Total wages from box 1 of all W-2s
  fields.push(
    numericField("1a", "Total amount from Form(s) W-2, box 1", ok(
      totalBox1,
      `Sum of box 1 across ${w2s.length} W-2(s).`,
      w2FactKeys,
    )),
  );

  // Line 1z — Sum of 1a–1h (only 1a populated for now)
  fields.push(
    numericField("1z", "Add lines 1a through 1h", ok(
      totalBox1,
      "Currently only line 1a is populated.",
      w2FactKeys,
    )),
  );

  // ─── Dividends from 1099-DIVs ───
  const divs = getDividendFacts(ctx.facts);
  const totalQualDivs = divs.reduce((s, d) => s + (d.dividends.box1b ?? 0), 0);
  const totalOrdDivs = divs.reduce((s, d) => s + (d.dividends.box1a ?? 0), 0);
  const divFactKeys = divs.map((d) => d.sourceFact.key);

  // Line 3a — Qualified dividends (1099-DIV box 1b)
  fields.push(
    numericField("3a", "Qualified dividends", ok(
      totalQualDivs,
      `Sum of 1099-DIV box 1b across ${divs.length} account(s).`,
      divFactKeys,
    )),
  );

  // Line 3b — Ordinary dividends (1099-DIV box 1a)
  fields.push(
    numericField("3b", "Ordinary dividends", ok(
      totalOrdDivs,
      `Sum of 1099-DIV box 1a across ${divs.length} account(s).`,
      divFactKeys,
    )),
  );

  // ─── Capital gain/(loss) from Schedule D ───
  // Three states to handle:
  //   (a) Schedule D not required → line 7 = 0, citing the not-required reason
  //   (b) Schedule D required but line 16 missing/blocked → propagate block
  //   (c) Schedule D required and computed → use line 16's value
  const line7Result: DerivationResult<number> = (() => {
    if (!scheduleD.mustFile.ok) {
      return blocked(
        `Schedule D mustFile is blocked: ${scheduleD.mustFile.reason}`,
        {
          decisionKey: scheduleD.mustFile.missingDecisionKey,
          factKeys: scheduleD.mustFile.missingFactKeys,
        },
      );
    }
    if (scheduleD.mustFile.value === false) {
      // (a) Schedule D not required → line 7 is zero with proper rationale
      return ok(
        0,
        `Schedule D not required: ${scheduleD.mustFile.rationale}`,
        scheduleD.mustFile.supportingFactKeys,
      );
    }
    // Schedule D required — find line 16
    const sdLine16 = scheduleD.fields.find(
      (l): l is ScheduleDSingleValueField =>
        l.formFieldKind === "schedule-d.single" && l.lineNumber === "16",
    );
    if (!sdLine16) {
      return blocked("Schedule D required but line 16 was not emitted");
    }
    if (!sdLine16.result.ok) {
      return blocked(
        `Schedule D line 16 blocked: ${sdLine16.result.reason}`,
        {
          decisionKey: sdLine16.result.missingDecisionKey,
          factKeys: sdLine16.result.missingFactKeys,
        },
      );
    }
    return ok(
      sdLine16.result.value,
      "From Schedule D line 16.",
      sdLine16.result.supportingFactKeys,
    );
  })();

  fields.push(
    numericField("7", "Capital gain or (loss). Attach Schedule D if required", line7Result),
  );

  // For downstream computations: if line 7 is blocked, downstream lines that
  // include it (line 9, 11, 15, 16, 24, 33, 34/37) will all use 0. The
  // blocked state on line 7 is still surfaced; the agent can see "line 7 is
  // stuck" and chase the upstream issue.
  const capitalGain = line7Result.ok ? line7Result.value : 0;
  const sdLine16FactKeys = line7Result.ok ? line7Result.supportingFactKeys : [];

  // ─── Total income (line 9) ───
  // For Alejandro: 1z (wages) + 3b (ordinary divs) + 7 (cap gain).
  // (When we add interest, IRA, SS, etc., add those to this sum.)
  const totalIncome = totalBox1 + totalOrdDivs + capitalGain;
  fields.push(
    numericField("9", "Total income", ok(
      totalIncome,
      "Sum of lines 1z, 3b, 7 (only ones populated for this return).",
      [...w2FactKeys, ...divFactKeys, ...sdLine16FactKeys],
    )),
  );

  // Line 10 — Adjustments to income (Schedule 1) — zero for now
  fields.push(
    numericField("10", "Adjustments to income from Schedule 1", ok(
      0,
      "No Schedule 1 adjustments for this return.",
      [],
    )),
  );

  // Line 11 — AGI
  const agi = totalIncome - 0;
  fields.push(
    numericField("11", "Adjusted gross income (line 9 − line 10)", ok(
      agi,
      "Line 9 minus line 10.",
      [...w2FactKeys, ...divFactKeys, ...sdLine16FactKeys],
    )),
  );

  // ─── Standard deduction (line 12) — depends on filing-status decision ───
  const filingStatus = ctx.decisions.get("decisions.scope.filing_status");
  if (!filingStatus) {
    fields.push(
      numericField("12", "Standard deduction",
        blocked("Need filing-status decision to look up standard deduction", {
          decisionKey: "decisions.scope.filing_status",
        }),
      ),
    );
    return { ...baseForm, fields };
  }
  const fs = String(filingStatus.decision);
  const stdDed = STANDARD_DEDUCTION_2025[fs];
  if (stdDed === undefined) {
    fields.push(
      numericField("12", "Standard deduction",
        blocked(
          `Unknown filing status "${fs}"; expected one of ${Object.keys(STANDARD_DEDUCTION_2025).join(", ")}`,
          { decisionKey: "decisions.scope.filing_status" },
        ),
      ),
    );
    return { ...baseForm, fields };
  }
  fields.push(
    numericField("12", "Standard deduction", ok(
      stdDed,
      `2025 standard deduction for ${fs}.`,
      filingStatus.supportingFactKeys,
      "decisions.scope.filing_status",
    )),
  );

  // Line 13 — QBI deduction (Form 8995). Zero for Alejandro.
  fields.push(
    numericField("13", "Qualified business income deduction", ok(
      0,
      "No QBI deduction for this return.",
      [],
    )),
  );

  // Line 14 — Sum of 12 + 13
  const line14 = stdDed + 0;
  fields.push(
    numericField("14", "Add lines 12 and 13", ok(
      line14,
      "Standard deduction + QBI.",
      filingStatus.supportingFactKeys,
    )),
  );

  // Line 15 — Taxable income (line 11 − line 14, floored at 0)
  const taxable = Math.max(0, agi - line14);
  fields.push(
    numericField("15", "Taxable income (line 11 − line 14, not less than 0)", ok(
      taxable,
      "AGI minus deductions.",
      [...w2FactKeys, ...divFactKeys, ...sdLine16FactKeys, ...filingStatus.supportingFactKeys],
    )),
  );

  // Line 16 — Tax. SIMPLIFIED: ordinary brackets only.
  const tax = ordinaryTaxSingle(taxable);
  fields.push(
    numericField("16", "Tax", ok(
      tax,
      "Computed via 2025 single ordinary brackets. " +
      "Note: Qualified Dividends and Capital Gain Tax Worksheet not yet applied — " +
      "this overstates tax when the return has qualified dividends or net long-term gains.",
      [],
    )),
  );

  // Line 23 — Other taxes (Schedule 2). Zero for Alejandro.
  fields.push(
    numericField("23", "Other taxes from Schedule 2", ok(
      0,
      "No other taxes.",
      [],
    )),
  );

  // Line 24 — Total tax
  const totalTax = tax + 0;
  fields.push(
    numericField("24", "Total tax (line 16 + line 23)", ok(
      totalTax,
      "Tax + other taxes.",
      [],
    )),
  );

  // Line 25a — Federal income tax withheld from W-2s
  fields.push(
    numericField("25a", "Federal income tax withheld from Form(s) W-2", ok(
      totalBox2,
      `Sum of box 2 across ${w2s.length} W-2(s).`,
      w2FactKeys,
    )),
  );

  // Line 33 — Total payments
  // For Alejandro just 25a; will add 25b/25c/26-32 as those data sources arrive.
  const totalPayments = totalBox2;
  fields.push(
    numericField("33", "Total payments", ok(
      totalPayments,
      "Currently only line 25a contributes.",
      w2FactKeys,
    )),
  );

  // Lines 34 / 37 — Refund or amount owed
  if (totalPayments >= totalTax) {
    fields.push(
      numericField("34", "Amount overpaid (line 33 − line 24)", ok(
        Math.round((totalPayments - totalTax) * 100) / 100,
        "Refund owed to taxpayer.",
        w2FactKeys,
      )),
    );
  } else {
    fields.push(
      numericField("37", "Amount you owe (line 24 − line 33)", ok(
        Math.round((totalTax - totalPayments) * 100) / 100,
        "Balance due to IRS.",
        w2FactKeys,
      )),
    );
  }

  return { ...baseForm, fields };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function numericField(
  lineNumber: Form1040LineNumber,
  label: string,
  result: DerivationResult<number>,
): Form1040NumericField {
  return {
    formFieldKind: "form-1040.numeric",
    lineNumber,
    fieldId: `form-1040.line.${lineNumber}`,
    label,
    category: NUMERIC_CATEGORY[lineNumber],
    valueType: "numeric",
    result,
  };
}

function textFieldFromFact(
  fieldId: string,
  label: string,
  category: Category,
  factKey: string,
  ctx: DerivationContext,
): Form1040TextField {
  const fact = ctx.facts.get(factKey);
  if (!fact) {
    return {
      formFieldKind: "form-1040.text",
      fieldId,
      label,
      category,
      valueType: "text",
      result: blocked(`Need fact: ${factKey}`, { factKeys: [factKey] }),
    };
  }
  // Address is an object; everything else is already a primitive. Stringify
  // for the value side, but the renderer still reads the raw fact when it
  // needs the structured shape.
  const stringified =
    typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value);
  return {
    formFieldKind: "form-1040.text",
    fieldId,
    label,
    category,
    valueType: "text",
    result: ok(stringified, `From ${factKey}.`, [factKey]),
  };
}

function singleSelectFromDecision(
  fieldId: string,
  label: string,
  category: Category,
  decisionKey: string,
  ctx: DerivationContext,
): Form1040SingleSelectField {
  const d = ctx.decisions.get(decisionKey);
  if (!d) {
    return {
      formFieldKind: "form-1040.single-select",
      fieldId,
      label,
      category,
      valueType: "single_select",
      result: blocked(`Need decision: ${decisionKey}`, { decisionKey }),
    };
  }
  return {
    formFieldKind: "form-1040.single-select",
    fieldId,
    label,
    category,
    valueType: "single_select",
    result: ok(String(d.decision), d.rationale, d.supportingFactKeys, decisionKey),
  };
}

function mustFileForm1040(ctx: DerivationContext): DerivationResult<boolean> {
  const decision = ctx.decisions.get("decisions.scope.must_file_federal");
  if (!decision) {
    return blocked("Need scope decision: must_file_federal", {
      decisionKey: "decisions.scope.must_file_federal",
    });
  }
  return ok<boolean>(
    decision.decision === true,
    decision.rationale,
    decision.supportingFactKeys,
    "decisions.scope.must_file_federal",
  );
}
