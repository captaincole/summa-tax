// ScheduleCaFilingInfo — Schedule CA (540) specific slots layered on top
// of BaseFilingInfo.
//
// Schedule CA is almost entirely a derivative of federal Form 1040 — col
// A echoes federal income lines, col B/C records CA adjustments. Most
// bindings will read upstream values via cross-form references on the
// form accessor (e.g. f["form-1040.line.1a"]) rather than via FilingInfo.
//
// We keep this interface minimal on purpose: only the form-scoping flag
// for now. Add slots here if a Schedule CA binding ever needs a value
// that isn't reachable through the form accessor or BaseFilingInfo.

import type { BaseFilingInfo } from "../../../filingInfo.js";
import type { EngineDerivation } from "../../../types.js";

export interface ScheduleCaFilingInfo extends BaseFilingInfo {
  /**
   * Schedule CA (540) must-file determination. Driven by the
   * `decisions.scope.must_file_schedule_ca` AI decision. True when the
   * taxpayer files 540 and has any federal-vs-CA difference to record
   * (or when a CPA opts to file the schedule for documentation even
   * when col B/C are entirely zero).
   */
  mustFileScheduleCA?: boolean;
  /** Provenance for mustFileScheduleCA — populated by resolveFilingInfo. */
  mustFileScheduleCADerivation?: EngineDerivation;
}
