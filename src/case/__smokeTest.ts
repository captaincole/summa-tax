// Quick smoke test for the derivation graph. Run with:
//   npx tsx src/case/__smokeTest.ts
// Builds a fact map matching Alex (scenario 01) and prints the resulting
// case state. Not a formal test suite; just a confidence check before
// wiring Thom up.

import { computeCaseState } from "./engine";
import type { FactMap } from "./types";
import { alexDerivations } from "./derivations";
import { artifactScopeDerivations } from "../tax/artifacts";

// Alex's full fact set — what we'd have after a complete conversation.
const alexFacts: FactMap = {
  tax_year: 2025,
  "identity.filing_status": "single",
  "identity.name.first": "Alex",
  "identity.name.last": "Morales",
  "identity.ssn": "123-45-6789",
  "identity.address": {
    line1: "2245 Lakeshore Ave Apt 3",
    city: "Oakland",
    state: "CA",
    zip: "94606",
  },
  "identity.dependents_count": 0,
  "residency.state": "CA",
  "residency.full_year_in_state": true,

  "wages.has_w2_income": true,
  "mortgage.owns_home": false,
  "investment_income.has_accounts": false,
  "hsa.has_account": false,
  "self_employment.has_income": false,
  "k1.has_k1": false,
  "rental.has_rental": false,
  "foreign.has_accounts": false,
  "crypto.has_activity": false,
  "charitable.has_giving": true,

  "wages.w2_count": 1,
  "w2.employer.name": "Brightside Logistics, Inc.",
  "w2.employer.ein": "36-1234567",
  "w2.box1": 79000,
  "w2.box2": 9420,
  "w2.box3": 85000,
  "w2.box4": 5270,
  "w2.box5": 85000,
  "w2.box6": 1232.5,
  "w2.box12_entries": [{ code: "D", amount: 6000 }],
  "w2.box12_codes": ["D"],
  "w2.box13.retirement_plan": true,
  "w2.box14.ca_sdi": 935,
  "w2.box15": "CA",
  "w2.box16": 79000,
  "w2.box17": 3100,

  "charitable.total_cash_donations": 400,

  "retirement.contribution_401k": 6000,
};

const allDerivations = [...artifactScopeDerivations, ...alexDerivations];
const state = computeCaseState(alexFacts, allDerivations);

// Print the interesting bits.
const out = {
  scoping: {
    form1040: state.derivations["scope.form-1040"],
    ca540: state.derivations["scope.ca-form-540"],
    w2Source: state.derivations["scope.w2-source"],
    mvp: state.derivations["mvp.scope_check"],
  },
  money: {
    totalWages: state.derivations["money.total_wages"],
    agi: state.derivations["money.agi"],
    standardDeduction: state.derivations["deductions.standard_deduction"],
    itemizable: state.derivations["deductions.total_itemizable"],
    itemizeVsStd: state.derivations["decisions.itemize_vs_standard"],
    taxableIncome: state.derivations["money.taxable_income"],
    federalTax: state.derivations["money.federal_tax_owed"],
    federalWithholding: state.derivations["money.total_federal_withholding"],
    refundOrBalance: state.derivations["money.refund_or_balance_due"],
  },
  credits: {
    saversCredit: state.derivations["credits.savers_credit"],
  },
  case: {
    progress: state.derivations["case.progress"],
    openAsks: state.derivations["case.open_asks"],
  },
  draft1040: state.derivations["forms.draft_1040"],
};

console.log(JSON.stringify(out, null, 2));

// Sanity checks (print-only; fail loudly if obviously wrong)
const money = out.money;
type ItemizeDecision = { decision: string };
type RefundOrBalance = { direction: string; amount: number };
const mvp = out.scoping.mvp as { withinMvp: boolean; violations: string[] };
const itemize = money.itemizeVsStd as ItemizeDecision;
const refund = money.refundOrBalance as RefundOrBalance;

const failures: string[] = [];
if (mvp.withinMvp !== true) failures.push("Expected withinMvp=true for Alex");
if (itemize.decision !== "standard") failures.push("Expected standard deduction decision");
if (refund.direction !== "refund") failures.push("Expected refund for Alex");
if (money.taxableIncome !== 64000) failures.push(`Expected taxable income $64,000, got ${money.taxableIncome}`);

if (failures.length > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nAll sanity checks passed.");
