// Form8959FilingInfo — Form 8959 (Additional Medicare Tax) specific
// slots layered on top of BaseFilingInfo.
//
// Most of 8959's inputs already live elsewhere:
//   - Medicare wages (W-2 box 5) are summed by resolveFilingInfo into the
//     existing w2WagesTotal/w2FederalWithholding pattern — we just add a
//     parallel box-5 sum here.
//   - Medicare tax withheld (W-2 box 6) likewise.
//   - The filing-status threshold ($200k single / $250k MFJ / $125k MFS)
//     is derived inside the binding from info.filingStatus rather than
//     stored as a slot — it's a pure lookup with no per-form variation.
//
// Self-employment + RRTA inputs (lines 8/14) stay unsupported until a
// scenario with those facts exists.

import type { Money } from "../../values.js";
import type { BaseFilingInfo } from "../../filingInfo.js";
import type { EngineDerivation } from "../../types.js";

export interface Form8959FilingInfo extends BaseFilingInfo {
  /**
   * Form 8959 must-file determination. Driven by
   * `decisions.scope.must_file_8959`, with fallback to
   * "Medicare wages > $200,000 (or filing-status threshold)" — the IRS
   * trigger for the form. We don't compute the fallback here because the
   * threshold depends on filing status; resolver fallback uses W-2 box 5
   * > $200k single as the conservative trigger.
   */
  mustFile8959?: boolean;
  /** Provenance for mustFile8959. */
  mustFile8959Derivation?: EngineDerivation;

  /** Sum of W-2 Box 5 (Medicare wages and tips) across all employers. */
  w2MedicareWagesTotal?: Money;

  /** Sum of W-2 Box 6 (Medicare tax withheld) across all employers. */
  w2MedicareTaxWithheld?: Money;
}
