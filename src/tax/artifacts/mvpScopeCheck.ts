import { derive, fact } from "../../case";

// The MVP handles exactly this taxpayer shape:
//   - Single filing status
//   - No dependents
//   - California resident, all year
//   - One W-2 from one employer
//   - No income sources beyond W-2 wages (no 1099-*, K-1, SE, rental, crypto, foreign)
//   - Standard deduction (no itemizing; no mortgage interest)
//   - No HSA (no W-2 box 12 code W)
//   - No itemizable charitable gifts material to return
//
// When any of these assumptions is violated, Thom should decline with
// "Oh, we don't handle that scenario yet" rather than trying to proceed.
// This derivation walks the facts and returns a list of violations.

export type MvpScopeResult = {
  withinMvp: boolean;
  violations: string[]; // empty iff withinMvp is true
};

export const mvpScopeCheck = derive({
  id: "mvp.scope_check",
  description:
    "Aggregates out-of-MVP signals from the fact set. If any violation, Thom declines.",
  inputs: {
    filingStatus: fact<string | undefined>("identity.filing_status"),
    dependentsCount: fact<number | undefined>("identity.dependents_count"),
    residencyState: fact<string | undefined>("residency.state"),
    residencyFullYear: fact<boolean | undefined>("residency.full_year_in_state"),
    w2Count: fact<number | undefined>("wages.w2_count"),
    hasInvestmentAccounts: fact<boolean | undefined>(
      "investment_income.has_accounts",
    ),
    hasMortgageOrHome: fact<boolean | undefined>("mortgage.owns_home"),
    hasHSA: fact<boolean | undefined>("hsa.has_account"),
    hasSelfEmployment: fact<boolean | undefined>("self_employment.has_income"),
    hasK1: fact<boolean | undefined>("k1.has_k1"),
    hasRental: fact<boolean | undefined>("rental.has_rental"),
    hasForeign: fact<boolean | undefined>("foreign.has_accounts"),
    hasCrypto: fact<boolean | undefined>("crypto.has_activity"),
    w2Box12Codes: fact<string[] | undefined>("w2.box12_codes"),
  },
  compute: (inputs): MvpScopeResult => {
    const v: string[] = [];

    if (inputs.filingStatus !== undefined && inputs.filingStatus !== "single") {
      v.push(`Filing status "${inputs.filingStatus}" not supported (MVP: single only).`);
    }
    if (inputs.dependentsCount !== undefined && inputs.dependentsCount > 0) {
      v.push(`Taxpayer has dependents (not supported in MVP).`);
    }
    if (inputs.residencyState !== undefined && inputs.residencyState !== "CA") {
      v.push(`State of residence "${inputs.residencyState}" not supported (MVP: CA only).`);
    }
    if (inputs.residencyFullYear === false) {
      v.push(`Part-year or multi-state residency not supported (MVP: full-year single-state only).`);
    }
    if (inputs.w2Count !== undefined && inputs.w2Count > 1) {
      v.push(`Multiple W-2s not supported (MVP: one W-2 from one employer).`);
    }
    if (inputs.hasInvestmentAccounts === true) {
      v.push(`Investment accounts outside retirement (brokerage, HYSA interest, etc.) not supported in MVP.`);
    }
    if (inputs.hasMortgageOrHome === true) {
      v.push(`Home ownership / mortgage not supported in MVP (itemized deductions out of scope).`);
    }
    if (inputs.hasHSA === true || inputs.w2Box12Codes?.includes("W")) {
      v.push(`HSA activity (direct or via W-2 box 12 code W) not supported in MVP.`);
    }
    if (inputs.hasSelfEmployment === true) {
      v.push(`Self-employment income not supported in MVP.`);
    }
    if (inputs.hasK1 === true) {
      v.push(`K-1 income (partnership/S-corp/trust) not supported in MVP.`);
    }
    if (inputs.hasRental === true) {
      v.push(`Rental property income not supported in MVP.`);
    }
    if (inputs.hasForeign === true) {
      v.push(`Foreign accounts or income not supported in MVP.`);
    }
    if (inputs.hasCrypto === true) {
      v.push(`Crypto activity not supported in MVP.`);
    }

    return { withinMvp: v.length === 0, violations: v };
  },
});
