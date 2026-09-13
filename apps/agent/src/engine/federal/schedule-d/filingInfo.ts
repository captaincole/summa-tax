// ScheduleDFilingInfo — Schedule D (Capital Gains and Losses) specific
// slots layered on top of BaseFilingInfo.
//
// Schedule D is almost entirely a summarizer over 8949: it reads
// per-row totals from 8949 Part I / Part II via cross-form references,
// then nets them into line 16 (the value Form 1040 line 7a consumes).
// No FilingInfo slots are needed for the actual arithmetic — only the
// form-scoping flag for now.

import type { BaseFilingInfo } from "../../filingInfo.js";
import type { EngineDerivation } from "../../types.js";

export interface ScheduleDFilingInfo extends BaseFilingInfo {
  /**
   * Schedule D must-file determination. Driven by
   * `decisions.scope.must_file_schedule_d`. True when the taxpayer has
   * any capital gain or loss to report — covers 8949 transactions,
   * capital-gain distributions (1099-DIV box 2a), partnership/S-corp
   * pass-through gains, and similar.
   */
  mustFileScheduleD?: boolean;
  /** Provenance for mustFileScheduleD — populated by resolveFilingInfo. */
  mustFileScheduleDDerivation?: EngineDerivation;
}
