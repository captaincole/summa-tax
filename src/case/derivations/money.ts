import { derive, fact, derivation } from "../index";
import {
  BRACKETS_2025,
  computeBracketedTax,
  type FilingStatus,
} from "./tables";

// Total wages across all W-2s. In MVP we only support one W-2, so this
// is just a pass-through of w2.box1. The derivation exists so downstream
// math (AGI, taxable income) depends on a stable name even when we later
// support multiple W-2s.
export const totalWages = derive({
  id: "money.total_wages",
  description: "Sum of W-2 box 1 (wages, tips, other compensation) across all W-2s.",
  inputs: {
    w2Box1: fact<number | undefined>("w2.box1"),
  },
  compute: ({ w2Box1 }): number => w2Box1 ?? 0,
});

// Total federal income tax withheld — sum of W-2 box 2.
export const totalFederalWithholding = derive({
  id: "money.total_federal_withholding",
  description: "Sum of W-2 box 2 (federal income tax withheld) across all W-2s.",
  inputs: {
    w2Box2: fact<number | undefined>("w2.box2"),
  },
  compute: ({ w2Box2 }): number => w2Box2 ?? 0,
});

// Total state income tax withheld — sum of W-2 box 17.
export const totalStateWithholding = derive({
  id: "money.total_state_withholding",
  description: "Sum of W-2 box 17 (state income tax withheld) across all W-2s.",
  inputs: {
    w2Box17: fact<number | undefined>("w2.box17"),
  },
  compute: ({ w2Box17 }): number => w2Box17 ?? 0,
});

// Adjusted gross income (AGI) — 1040 line 11.
// For MVP, AGI = total wages (no above-the-line adjustments supported).
export const agi = derive({
  id: "money.agi",
  description:
    "Adjusted gross income. MVP: total W-2 wages with no adjustments.",
  inputs: {
    totalWages: derivation<number>("money.total_wages"),
  },
  compute: ({ totalWages }): number => totalWages,
});

// Taxable income — 1040 line 15.
// AGI minus the greater of standard or itemized deduction (MVP: always
// standard). QBI deduction not in MVP.
export const taxableIncome = derive({
  id: "money.taxable_income",
  description: "AGI minus standard deduction (MVP; no itemizing, no QBI).",
  inputs: {
    agi: derivation<number>("money.agi"),
    standardDeduction: derivation<number>("deductions.standard_deduction"),
  },
  compute: ({ agi, standardDeduction }): number =>
    Math.max(0, agi - standardDeduction),
});

// Federal tax on taxable income — 1040 line 16. Uses bracketed ordinary
// rates for the filing status. MVP doesn't handle AMT, LTCG, or qualified
// dividend preferences.
export const federalTaxOwed = derive({
  id: "money.federal_tax_owed",
  description:
    "Federal income tax on taxable income using 2025 bracketed rates for the filing status.",
  inputs: {
    taxableIncome: derivation<number>("money.taxable_income"),
    filingStatus: fact<FilingStatus | undefined>("identity.filing_status"),
    taxYear: fact<number | undefined>("tax_year"),
  },
  compute: ({ taxableIncome, filingStatus, taxYear }): number => {
    if (filingStatus === undefined || taxYear !== 2025) return 0;
    const brackets = BRACKETS_2025[filingStatus];
    return computeBracketedTax(taxableIncome, brackets);
  },
});

// Refund or balance due — comparing what was withheld vs what's owed.
// Positive refund = taxpayer overpaid via withholding.
export type RefundOrBalance = {
  direction: "refund" | "balance_due" | "even";
  amount: number;
};

export const refundOrBalanceDue = derive({
  id: "money.refund_or_balance_due",
  description:
    "Net of federal withholding vs. federal tax owed. MVP ignores credits and other payments.",
  inputs: {
    federalTaxOwed: derivation<number>("money.federal_tax_owed"),
    totalFederalWithholding: derivation<number>("money.total_federal_withholding"),
  },
  compute: ({ federalTaxOwed, totalFederalWithholding }): RefundOrBalance => {
    const net = totalFederalWithholding - federalTaxOwed;
    if (net > 0.005) return { direction: "refund", amount: Math.round(net * 100) / 100 };
    if (net < -0.005) return { direction: "balance_due", amount: Math.round(-net * 100) / 100 };
    return { direction: "even", amount: 0 };
  },
});
