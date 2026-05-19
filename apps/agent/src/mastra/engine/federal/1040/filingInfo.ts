// Form1040FilingInfo — federal-1040-specific slots layered on top of the
// shared BaseFilingInfo (identity + cross-form scope).
//
// Add slots here when a 1040 binding first references one. State forms
// that need any of these can import this type directly — TS doesn't care
// about folder hierarchy.

import type { Money } from "../../values.js";
import type { BaseFilingInfo } from "../../filingInfo.js";

export interface Form1040FilingInfo extends BaseFilingInfo {
  /** Federal Form 1040 must-file determination. */
  mustFileFederal?: boolean;

  /**
   * Digital-assets question (1040 page 1) — every filer must answer.
   * True when the taxpayer received, sold, or otherwise transacted in
   * a digital asset (crypto / NFT / etc.) during the tax year. Drives
   * which of the two yes/no checkboxes renders. Undefined means
   * "scenario hasn't recorded the decision yet" — neither checkbox
   * fires, surfacing the gap loudly.
   */
  hasDigitalAssets?: boolean;

  // ─── W-2 federal aggregates ─────────────────────────────────────────
  /** Sum of W-2 Box 1 (federal taxable wages) across all employers. */
  w2WagesTotal?: Money;
  /** Sum of W-2 Box 2 (federal income tax withheld) across all employers. */
  w2FederalWithholding?: Money;

  // ─── 1099-DIV aggregates ─────────────────────────────────────────────
  /** Sum of 1099-DIV Box 1a across all accounts. */
  ordinaryDividends?: Money;
  /** Sum of 1099-DIV Box 1b across all accounts. */
  qualifiedDividends?: Money;
  /** Sum of 1099 Box 4 (federal income tax withheld on 1099 forms). */
  form1099FederalWithholding?: Money;

  /**
   * Refund the federal overpayment in full vs apply some to 2026 estimated
   * tax. Federal decision; the state-level analog lives on Form540FilingInfo
   * because a taxpayer can choose differently between jurisdictions.
   */
  refundFullOverpaymentFederal?: boolean;
}
