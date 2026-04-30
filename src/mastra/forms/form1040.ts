// Form 1040 — U.S. Individual Income Tax Return
//
// Pulls W-2 wage data and 1099-DIV box totals from the fact catalog, takes
// Schedule D as a parameter for capital gains, applies the standard
// deduction (per filing-status decision), computes taxable income, and
// produces the tax owed / refund.
//
// Scope for the first iteration (Alejandro):
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
  type BaseLine,
  type DerivationContext,
  type DerivationResult,
  type EvaluatedForm,
} from "./types.js";
import type { EvaluatedScheduleD, ScheduleDSingleValueLine } from "./scheduleD.js";
import { getDividendFacts, getW2Facts } from "../facts/index.js";

// ─── Line shape ──────────────────────────────────────────────────────────

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

export interface Form1040NumericLine extends BaseLine<number> {
  lineKind: "form-1040.numeric";
  lineNumber: Form1040LineNumber;
}

export type Form1040Line = Form1040NumericLine;

export type EvaluatedForm1040 = EvaluatedForm<Form1040Line>;

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
  const lines: Form1040Line[] = [];

  const mustFile = mustFileForm1040(ctx);
  const baseForm: Omit<EvaluatedForm1040, "lines"> = {
    formId: "form-1040",
    jurisdiction: "federal",
    title: "U.S. Individual Income Tax Return",
    taxYear: ctx.taxYear,
    mustFile,
  };
  if (!mustFile.ok || !mustFile.value) {
    return { ...baseForm, lines };
  }

  // ─── Wages from W-2s ───
  const w2s = getW2Facts(ctx.facts);
  const totalBox1 = w2s.reduce((s, w) => s + (w.w2.box1 ?? 0), 0);
  const totalBox2 = w2s.reduce((s, w) => s + (w.w2.box2 ?? 0), 0);
  const w2FactKeys = w2s.map((w) => w.sourceFact.key);

  // Line 1a — Total wages from box 1 of all W-2s
  lines.push(
    numericLine("1a", "Total amount from Form(s) W-2, box 1", ok(
      totalBox1,
      `Sum of box 1 across ${w2s.length} W-2(s).`,
      w2FactKeys,
    )),
  );

  // Line 1z — Sum of 1a–1h (only 1a populated for now)
  lines.push(
    numericLine("1z", "Add lines 1a through 1h", ok(
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
  lines.push(
    numericLine("3a", "Qualified dividends", ok(
      totalQualDivs,
      `Sum of 1099-DIV box 1b across ${divs.length} account(s).`,
      divFactKeys,
    )),
  );

  // Line 3b — Ordinary dividends (1099-DIV box 1a)
  lines.push(
    numericLine("3b", "Ordinary dividends", ok(
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
    const sdLine16 = scheduleD.lines.find(
      (l): l is ScheduleDSingleValueLine =>
        l.lineKind === "schedule-d.single" && l.lineNumber === "16",
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

  lines.push(
    numericLine("7", "Capital gain or (loss). Attach Schedule D if required", line7Result),
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
  lines.push(
    numericLine("9", "Total income", ok(
      totalIncome,
      "Sum of lines 1z, 3b, 7 (only ones populated for this return).",
      [...w2FactKeys, ...divFactKeys, ...sdLine16FactKeys],
    )),
  );

  // Line 10 — Adjustments to income (Schedule 1) — zero for now
  lines.push(
    numericLine("10", "Adjustments to income from Schedule 1", ok(
      0,
      "No Schedule 1 adjustments for this return.",
      [],
    )),
  );

  // Line 11 — AGI
  const agi = totalIncome - 0;
  lines.push(
    numericLine("11", "Adjusted gross income (line 9 − line 10)", ok(
      agi,
      "Line 9 minus line 10.",
      [...w2FactKeys, ...divFactKeys, ...sdLine16FactKeys],
    )),
  );

  // ─── Standard deduction (line 12) — depends on filing-status decision ───
  const filingStatus = ctx.decisions.get("decisions.scope.filing_status");
  if (!filingStatus) {
    lines.push({
      lineKind: "form-1040.numeric",
      lineNumber: "12",
      lineId: "form-1040.line.12",
      label: "Standard deduction",
      result: blocked("Need filing-status decision to look up standard deduction", {
        decisionKey: "decisions.scope.filing_status",
      }),
    });
    return { ...baseForm, lines };
  }
  const fs = String(filingStatus.decision);
  const stdDed = STANDARD_DEDUCTION_2025[fs];
  if (stdDed === undefined) {
    lines.push({
      lineKind: "form-1040.numeric",
      lineNumber: "12",
      lineId: "form-1040.line.12",
      label: "Standard deduction",
      result: blocked(
        `Unknown filing status "${fs}"; expected one of ${Object.keys(STANDARD_DEDUCTION_2025).join(", ")}`,
        { decisionKey: "decisions.scope.filing_status" },
      ),
    });
    return { ...baseForm, lines };
  }
  lines.push(
    numericLine("12", "Standard deduction", ok(
      stdDed,
      `2025 standard deduction for ${fs}.`,
      filingStatus.supportingFactKeys,
      "decisions.scope.filing_status",
    )),
  );

  // Line 13 — QBI deduction (Form 8995). Zero for Alejandro.
  lines.push(
    numericLine("13", "Qualified business income deduction", ok(
      0,
      "No QBI deduction for this return.",
      [],
    )),
  );

  // Line 14 — Sum of 12 + 13
  const line14 = stdDed + 0;
  lines.push(
    numericLine("14", "Add lines 12 and 13", ok(
      line14,
      "Standard deduction + QBI.",
      filingStatus.supportingFactKeys,
    )),
  );

  // Line 15 — Taxable income (line 11 − line 14, floored at 0)
  const taxable = Math.max(0, agi - line14);
  lines.push(
    numericLine("15", "Taxable income (line 11 − line 14, not less than 0)", ok(
      taxable,
      "AGI minus deductions.",
      [...w2FactKeys, ...divFactKeys, ...sdLine16FactKeys, ...filingStatus.supportingFactKeys],
    )),
  );

  // Line 16 — Tax. SIMPLIFIED: ordinary brackets only.
  const tax = ordinaryTaxSingle(taxable);
  lines.push(
    numericLine("16", "Tax", ok(
      tax,
      "Computed via 2025 single ordinary brackets. " +
      "Note: Qualified Dividends and Capital Gain Tax Worksheet not yet applied — " +
      "this overstates tax when the return has qualified dividends or net long-term gains.",
      [],
    )),
  );

  // Line 23 — Other taxes (Schedule 2). Zero for Alejandro.
  lines.push(
    numericLine("23", "Other taxes from Schedule 2", ok(
      0,
      "No other taxes.",
      [],
    )),
  );

  // Line 24 — Total tax
  const totalTax = tax + 0;
  lines.push(
    numericLine("24", "Total tax (line 16 + line 23)", ok(
      totalTax,
      "Tax + other taxes.",
      [],
    )),
  );

  // Line 25a — Federal income tax withheld from W-2s
  lines.push(
    numericLine("25a", "Federal income tax withheld from Form(s) W-2", ok(
      totalBox2,
      `Sum of box 2 across ${w2s.length} W-2(s).`,
      w2FactKeys,
    )),
  );

  // Line 33 — Total payments
  // For Alejandro just 25a; will add 25b/25c/26-32 as those data sources arrive.
  const totalPayments = totalBox2;
  lines.push(
    numericLine("33", "Total payments", ok(
      totalPayments,
      "Currently only line 25a contributes.",
      w2FactKeys,
    )),
  );

  // Lines 34 / 37 — Refund or amount owed
  if (totalPayments >= totalTax) {
    lines.push(
      numericLine("34", "Amount overpaid (line 33 − line 24)", ok(
        Math.round((totalPayments - totalTax) * 100) / 100,
        "Refund owed to taxpayer.",
        w2FactKeys,
      )),
    );
  } else {
    lines.push(
      numericLine("37", "Amount you owe (line 24 − line 33)", ok(
        Math.round((totalTax - totalPayments) * 100) / 100,
        "Balance due to IRS.",
        w2FactKeys,
      )),
    );
  }

  return { ...baseForm, lines };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function numericLine(
  lineNumber: Form1040LineNumber,
  label: string,
  result: DerivationResult<number>,
): Form1040NumericLine {
  return {
    lineKind: "form-1040.numeric",
    lineNumber,
    lineId: `form-1040.line.${lineNumber}`,
    label,
    result,
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
