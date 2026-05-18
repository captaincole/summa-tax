// Form8949FilingInfo — Form 8949 (Sales and Other Dispositions of Capital
// Assets) specific slots layered on top of BaseFilingInfo.
//
// 8949 itemizes individual security sales — each TradeFact maps 1:1 to a
// row on the form. The actual trade data flows through the form accessor
// via `getTradeFacts(ctx.facts)` rather than through FilingInfo, so this
// interface is minimal — only the form-scoping flag for now.

import type { BaseFilingInfo } from "../../filingInfo.js";
import type { TradeFactValue } from "../../../facts/index.js";

export interface Form8949FilingInfo extends BaseFilingInfo {
  /**
   * Form 8949 must-file determination. Driven by
   * `decisions.scope.must_file_8949`. True when there are reportable
   * security sales to itemize (effectively whenever Schedule D is filed
   * and at least one transaction needs row-level reporting).
   */
  mustFile8949?: boolean;

  /**
   * Trade facts partitioned by holding period for 8949 row assignment.
   * Each TradeFactValue maps 1:1 to a row on the form — short-term
   * trades populate Part I rows in order, long-term trades populate
   * Part II rows. Empty arrays when the taxpayer has no covered-
   * security sales of that type.
   *
   * Partition rule: held > 1 year (date_sold − date_acquired) ⇒ long-
   * term, else short-term. Matches IRC §1222 short/long-term split.
   */
  shortTermTrades?: TradeFactValue[];
  longTermTrades?: TradeFactValue[];
}
