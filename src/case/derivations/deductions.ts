import { derive, derivation, fact } from "../index";
import { STANDARD_DEDUCTION_2025, type FilingStatus } from "./tables";

// Standard deduction for the taxpayer's filing status and year.
export const standardDeduction = derive({
  id: "deductions.standard_deduction",
  description:
    "Standard deduction for the filing status and year. MVP supports 2025 only.",
  inputs: {
    filingStatus: fact<FilingStatus | undefined>("identity.filing_status"),
    taxYear: fact<number | undefined>("tax_year"),
  },
  compute: ({ filingStatus, taxYear }): number => {
    if (filingStatus === undefined || taxYear !== 2025) return 0;
    return STANDARD_DEDUCTION_2025[filingStatus];
  },
});

// MVP itemizable total — extremely simplified because the MVP doesn't
// support itemizing. We still compute the number for observability
// (so Thom / CPA can confirm "yes, standard wins by a wide margin")
// and for the itemize-vs-standard decision derivation.
//
// In the MVP scenario (Alex), only the state income tax withheld and
// small charitable cash gifts contribute. SALT cap and mortgage interest
// are out of scope.
export const totalItemizableDeductions = derive({
  id: "deductions.total_itemizable",
  description:
    "Sum of itemizable deductions we're tracking in MVP. Only W-2 state withholding and small cash charity.",
  inputs: {
    stateWithholding: derivation<number>("money.total_state_withholding"),
    caSdi: fact<number | undefined>("w2.box14.ca_sdi"),
    charitableCashTotal: fact<number | undefined>("charitable.total_cash_donations"),
  },
  compute: ({ stateWithholding, caSdi, charitableCashTotal }): number => {
    return (stateWithholding ?? 0) + (caSdi ?? 0) + (charitableCashTotal ?? 0);
  },
});

export type ItemizeDecision = {
  decision: "standard" | "itemize";
  standardDeduction: number;
  itemizedTotal: number;
  delta: number; // positive = standard wins by this much
  rationale: string;
};

export const itemizeVsStandard = derive({
  id: "decisions.itemize_vs_standard",
  description:
    "Decides whether itemizing would beat the standard deduction. For MVP, we expect standard to always win.",
  inputs: {
    standardDeduction: derivation<number>("deductions.standard_deduction"),
    itemizedTotal: derivation<number>("deductions.total_itemizable"),
  },
  compute: ({ standardDeduction, itemizedTotal }): ItemizeDecision => {
    const delta = standardDeduction - itemizedTotal;
    if (itemizedTotal > standardDeduction) {
      return {
        decision: "itemize",
        standardDeduction,
        itemizedTotal,
        delta,
        rationale: `Itemized $${itemizedTotal.toLocaleString()} exceeds standard $${standardDeduction.toLocaleString()} by $${(-delta).toLocaleString()}.`,
      };
    }
    return {
      decision: "standard",
      standardDeduction,
      itemizedTotal,
      delta,
      rationale: `Standard $${standardDeduction.toLocaleString()} beats itemized $${itemizedTotal.toLocaleString()} by $${delta.toLocaleString()}.`,
    };
  },
});
