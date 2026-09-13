// ScheduleAFilingInfo — Schedule A (Itemized Deductions) specific slots
// layered on top of BaseFilingInfo.
//
// Schedule A reads upstream amounts from a mix of W-2 box totals (state
// income tax withheld + CA SDI), single-value facts for property tax /
// mortgage interest / charity, and one cross-form reference (Form 1040
// line 11b for AGI, read directly in the binding — not here).
//
// Slots resolve from raw facts via simple key lookups today. As scenarios
// expand we'll replace those with proper fact-kind aggregation (e.g.
// summing across multiple 1098s, applying basis-adjustment to noncash
// gifts > $5,000). The slot shape stays stable; only the resolver moves.

import type { BaseFilingInfo } from "../../filingInfo.js";
import type { EngineDerivation } from "../../types.js";

export interface ScheduleAFilingInfo extends BaseFilingInfo {
  /**
   * Schedule A must-file determination. Driven by
   * `decisions.scope.must_file_schedule_a`, with fallback to
   * `decisions.itemize_vs_standard === "itemized"`. Required because
   * Schedule A is optional — taxpayers may itemize or take the standard
   * deduction; Schedule A is filed only on the itemized side.
   */
  mustFileScheduleA?: boolean;
  /** Provenance for mustFileScheduleA — populated by resolveFilingInfo. */
  mustFileScheduleADerivation?: EngineDerivation;

  // ─── Line 1: medical & dental ────────────────────────────────────────
  /**
   * Total medical and dental expenses paid during the tax year. Goes on
   * line 1; line 4 nets it against 7.5% of AGI (the threshold haircut).
   */
  medicalDentalExpenses?: number;

  // ─── Lines 5a–5c: taxes paid ─────────────────────────────────────────
  /**
   * Total state and local income tax paid during the tax year (cash basis):
   * W-2 box 17 (state withholding) + CA SDI (W-2 box 14) + state estimated
   * payments + prior-year balance-due paid this year − refunds claimed last
   * year as itemized. For Marcus this is W-2 box 17 + CA SDI only.
   *
   * Goes on line 5a unless `generalSalesTaxElection` is true. The election
   * lets taxpayers in no-income-tax states (TX, FL, etc.) deduct sales tax
   * instead — irrelevant for CA filers but the slot exists for correctness.
   */
  stateLocalIncomeTaxPaid?: number;

  /**
   * Taxpayer elects to deduct general sales taxes instead of state/local
   * income taxes (line 5a checkbox). Only meaningful in no-income-tax
   * states; CA filers always leave this false.
   */
  generalSalesTaxElection?: boolean;

  /** State and local real estate (property) taxes paid (line 5b). */
  realEstateTaxes?: number;

  /** State and local personal property taxes paid (line 5c). */
  personalPropertyTaxes?: number;

  // ─── Lines 8a–9: interest paid ───────────────────────────────────────
  /**
   * Home mortgage interest + points reported on Form 1098 box 1.
   * Single-1098 case for now; multi-1098 case will sum across mortgage
   * facts when we add the fact kind.
   */
  mortgageInterestForm1098?: number;

  /** Home mortgage interest not reported on Form 1098 (rare — seller-financed). */
  mortgageInterestNotForm1098?: number;

  /** Points paid on home loan not reported on Form 1098 (line 8c). */
  pointsNotForm1098?: number;

  /** Investment interest expense (line 9). Form 4952 attachment when required. */
  investmentInterest?: number;

  // ─── Lines 11–13: gifts to charity ───────────────────────────────────
  /** Cash or check gifts to qualified charities (line 11). */
  giftsCashCheck?: number;

  /** Non-cash gifts to qualified charities — appreciated stock, goods, etc. (line 12). */
  giftsOtherThanCash?: number;

  /** Carryover charitable contribution from a prior year (line 13). */
  giftsCarryover?: number;
}
