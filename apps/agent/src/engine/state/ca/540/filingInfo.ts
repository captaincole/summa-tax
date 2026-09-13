// Form540FilingInfo — California Form 540 specific slots.
//
// CA 540 cross-references federal Form 1040 line-by-line (AGI, taxable
// income, etc.) but those flow through the form accessor `f`, not through
// FilingInfo. FilingInfo slots are values produced by the AI resolver from
// taxpayer facts + documents.

import type { Money } from "../../../values.js";
import type { BaseFilingInfo } from "../../../filingInfo.js";
import type { EngineDerivation } from "../../../types.js";

export interface Form540FilingInfo extends BaseFilingInfo {
  /** California Form 540 must-file determination. */
  mustFileCA540?: boolean;
  /** Provenance for mustFileCA540 — populated by resolveFilingInfo. */
  mustFileCA540Derivation?: EngineDerivation;

  /** "full_year" | "part_year" | "non_resident". */
  caResidencyStatus?: string;

  // ─── W-2 state aggregates ────────────────────────────────────────────
  /** Sum of W-2 Box 16 (state wages, the filing state) across all employers. */
  w2StateWages?: Money;
  /** Sum of W-2 Box 17 (state income tax withheld) across all employers. */
  w2StateWithholding?: Money;
  /** Sum of W-2 Box 14 CA SDI entries — used by CA 540 excess-SDI logic. */
  w2CaSdiTotal?: Money;

  // ─── CA-specific scope ───────────────────────────────────────────────
  /** Whether the taxpayer owes use tax (drives CA 540 line 91). */
  useTaxOwed?: Money;
  /** True when no out-of-state purchases triggered a use-tax obligation. */
  noUseTaxOwed?: boolean;
  /**
   * If use tax is zero, the reason — drives the line 91 radio group.
   * Values: "no_use_tax_owed" | "paid_directly_to_cdtfa".
   */
  useTaxZeroReason?: string;
  /** Mailing address matches principal residence. */
  mailingSameAsResidence?: boolean;
  /**
   * Refund the California overpayment in full vs apply some to 2026
   * estimated tax. Separate from the federal decision — a taxpayer can
   * carry forward federal but refund state, or any combination.
   */
  refundFullOverpaymentCA?: boolean;
}
