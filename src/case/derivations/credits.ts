import { derive, derivation, fact } from "../index";
import { SAVERS_CREDIT_2025, type FilingStatus } from "./tables";

export type SaversCreditResult = {
  eligible: boolean;
  creditRate: number;          // 0, 0.10, 0.20, or 0.50
  qualifiedContribution: number; // capped at $2,000 single / $4,000 MFJ
  estimatedCredit: number;
  rationale: string;
};

// Form 8880 — Retirement Savings Contributions Credit (Saver's Credit).
// Eligibility: 18+, not a full-time student, not a dependent, and AGI
// below the filing-status threshold. Credit rate steps down as AGI rises.
//
// MVP simplification: we check AGI only. Age/student/dependent disqualifiers
// get added when we support those scoping branches.
export const saversCreditEligibility = derive({
  id: "credits.savers_credit",
  description:
    "Saver's Credit (Form 8880) eligibility based on AGI and filing status. MVP checks AGI only.",
  inputs: {
    agi: derivation<number>("money.agi"),
    filingStatus: fact<FilingStatus | undefined>("identity.filing_status"),
    taxYear: fact<number | undefined>("tax_year"),
    retirementContribution: fact<number | undefined>("retirement.contribution_401k"),
  },
  compute: ({
    agi,
    filingStatus,
    taxYear,
    retirementContribution,
  }): SaversCreditResult => {
    if (filingStatus === undefined || taxYear !== 2025) {
      return {
        eligible: false,
        creditRate: 0,
        qualifiedContribution: 0,
        estimatedCredit: 0,
        rationale: "Filing status or tax year not available yet.",
      };
    }

    const tiers = SAVERS_CREDIT_2025[filingStatus];
    const topLimit = tiers[tiers.length - 1].maxAgi;
    if (agi > topLimit) {
      return {
        eligible: false,
        creditRate: 0,
        qualifiedContribution: 0,
        estimatedCredit: 0,
        rationale: `AGI $${agi.toLocaleString()} exceeds the ${filingStatus.toUpperCase()} cap of $${topLimit.toLocaleString()} for 2025.`,
      };
    }

    const tier = tiers.find((t) => agi <= t.maxAgi);
    if (!tier) {
      return {
        eligible: false,
        creditRate: 0,
        qualifiedContribution: 0,
        estimatedCredit: 0,
        rationale: `No matching Saver's Credit tier for AGI $${agi.toLocaleString()}.`,
      };
    }

    const cap = filingStatus === "mfj" || filingStatus === "qss" ? 4000 : 2000;
    const qualified = Math.min(retirementContribution ?? 0, cap);
    const estimated = Math.round(qualified * tier.rate * 100) / 100;

    return {
      eligible: qualified > 0,
      creditRate: tier.rate,
      qualifiedContribution: qualified,
      estimatedCredit: estimated,
      rationale:
        qualified > 0
          ? `AGI $${agi.toLocaleString()} qualifies for the ${(tier.rate * 100).toFixed(0)}% credit tier; $${qualified.toLocaleString()} of contributions → $${estimated.toLocaleString()} credit.`
          : `AGI $${agi.toLocaleString()} would qualify for the ${(tier.rate * 100).toFixed(0)}% tier, but no qualifying retirement contribution recorded.`,
    };
  },
});
