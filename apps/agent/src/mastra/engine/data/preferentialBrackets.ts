// Preferential-rate brackets for qualified dividends and net long-term
// capital gain. Used by the Qualified Dividends and Capital Gain Tax
// Worksheet (and the Schedule D Tax Worksheet when 28% gain / §1250 gain
// carve-outs are needed).
//
// Two thresholds per filing status × tax year:
//   - 0% rate ceiling — preferential dollars below this pay no tax
//   - 15% rate ceiling — preferential dollars between the two ceilings
//     pay 15%; dollars above the upper ceiling pay 20%
//
// "Stacking" rule: ordinary income consumes bracket room FIRST, then
// preferential income sits on top. So your preferential bucket starts
// at the level (line 1 ordinary bucket cap) on the brackets, not at $0.
// The worksheet handles this via lines 7–9 (0% consumption) and lines
// 12–17 (15% consumption).
//
// Source: IRS Form 1040 (2025) Instructions, page 38 — Qualified
// Dividends and Capital Gain Tax Worksheet, lines 6 and 13.
// Block id in the ingested corpus: irs-1040-inst-2025::p38::b00073.
// Inflation-adjusted values originate in Rev. Proc. 2024-40.

import type { FilingStatus } from "../values.js";

export interface PreferentialBrackets {
  /** Highest taxable income at which preferential dollars are taxed at 0%. */
  zeroRateCeiling: number;
  /**
   * Highest taxable income at which preferential dollars are taxed at 15%.
   * Above this, preferential dollars pay 20%.
   */
  fifteenRateCeiling: number;
}

interface BracketTable {
  taxYear: number;
  jurisdiction: "federal";
  source: { docId: string; blockId: string; page: number };
  byStatus: Record<FilingStatus, PreferentialBrackets>;
}

const BRACKETS_2025_FEDERAL: BracketTable = {
  taxYear: 2025,
  jurisdiction: "federal",
  source: {
    docId: "irs-1040-inst-2025",
    blockId: "irs-1040-inst-2025::p38::b00073",
    page: 38,
  },
  byStatus: {
    single: { zeroRateCeiling: 48350, fifteenRateCeiling: 533400 },
    married_filing_separately: { zeroRateCeiling: 48350, fifteenRateCeiling: 300000 },
    married_filing_jointly: { zeroRateCeiling: 96700, fifteenRateCeiling: 600050 },
    qualifying_surviving_spouse: { zeroRateCeiling: 96700, fifteenRateCeiling: 600050 },
    head_of_household: { zeroRateCeiling: 64750, fifteenRateCeiling: 566700 },
  },
};

const TABLES_BY_YEAR: Record<number, BracketTable> = {
  2025: BRACKETS_2025_FEDERAL,
};

/**
 * Returns the preferential-rate ceilings for a (taxYear, filingStatus).
 * Throws on unknown year or status — callers should guard at the
 * binding layer where they have access to the engine's `blocked` result
 * shape.
 */
export function lookupPreferentialBrackets(
  taxYear: number,
  filingStatus: FilingStatus,
): PreferentialBrackets {
  const table = TABLES_BY_YEAR[taxYear];
  if (!table) {
    throw new Error(
      `No preferential-rate brackets loaded for tax year ${taxYear}. Available: ${Object.keys(TABLES_BY_YEAR).join(", ")}.`,
    );
  }
  const brackets = table.byStatus[filingStatus];
  if (!brackets) {
    throw new Error(
      `Filing status "${filingStatus}" has no preferential-rate brackets in the ${taxYear} table.`,
    );
  }
  return brackets;
}
