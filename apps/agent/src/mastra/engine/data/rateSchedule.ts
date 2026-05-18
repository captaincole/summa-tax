// Federal tax-rate schedule for the Tax Computation Worksheet, used when
// taxable income (or the worksheet's ordinary bucket) is ≥ $100,000 and
// the IRS Tax Table doesn't apply.
//
// The IRS publishes this as a 5-row "multiply by rate, subtract a
// constant" schedule per filing status:
//
//     tax = income × (b) − (d)
//
// where (b) is the marginal rate and (d) is the cumulative tax in lower
// brackets (collapsed into a constant). Result is the same as adding up
// the bracket-by-bracket tax explicitly; the multiply/subtract form is
// what the IRS prints because it's a one-line lookup.
//
// Source: IRS Form 1040 (2025) Instructions, page 80 — Tax Computation
// Worksheet — Line 16. Block id: irs-1040-inst-2025::p80::b00132.
// Bracket boundaries originate in Rev. Proc. 2024-40.

import type { FilingStatus } from "../values.js";

export interface RateScheduleRow {
  /** Bracket lower bound, exclusive (income > overMin). */
  overMin: number;
  /** Bracket upper bound, inclusive (income ≤ overMax). Infinity for the top bracket. */
  overMax: number;
  /** Marginal rate as a decimal (e.g. 0.22 for 22%). */
  rate: number;
  /** Subtract-this constant; collapses the cumulative-lower-bracket tax. */
  subtractAmount: number;
}

interface RateScheduleTable {
  taxYear: number;
  jurisdiction: "federal";
  source: { docId: string; blockId: string; page: number };
  byStatus: Record<FilingStatus, RateScheduleRow[]>;
}

// All four filing statuses for 2025. Brackets must be ordered ascending
// by overMin (the lookup helper relies on that to find the matching row).
//
// Note: Single and MFS share the bracket BOUNDARIES at $103,350 / $197,300
// / $250,525 — they diverge above that ($626,350 → 37% for Single vs
// $375,800 → 37% for MFS). The subtractAmount values also identical for
// the bottom three rows because the underlying rates kick in at the same
// income for both statuses.
const SCHEDULE_2025_FEDERAL: RateScheduleTable = {
  taxYear: 2025,
  jurisdiction: "federal",
  source: {
    docId: "irs-1040-inst-2025",
    blockId: "irs-1040-inst-2025::p80::b00132",
    page: 80,
  },
  byStatus: {
    single: [
      { overMin: 100_000, overMax: 103_350, rate: 0.22, subtractAmount: 5_086.0 },
      { overMin: 103_350, overMax: 197_300, rate: 0.24, subtractAmount: 7_153.0 },
      { overMin: 197_300, overMax: 250_525, rate: 0.32, subtractAmount: 22_937.0 },
      { overMin: 250_525, overMax: 626_350, rate: 0.35, subtractAmount: 30_452.75 },
      { overMin: 626_350, overMax: Infinity, rate: 0.37, subtractAmount: 42_979.75 },
    ],
    married_filing_jointly: [
      { overMin: 100_000, overMax: 206_700, rate: 0.22, subtractAmount: 10_172.0 },
      { overMin: 206_700, overMax: 394_600, rate: 0.24, subtractAmount: 14_306.0 },
      { overMin: 394_600, overMax: 501_050, rate: 0.32, subtractAmount: 45_874.0 },
      { overMin: 501_050, overMax: 751_600, rate: 0.35, subtractAmount: 60_905.5 },
      { overMin: 751_600, overMax: Infinity, rate: 0.37, subtractAmount: 75_937.5 },
    ],
    qualifying_surviving_spouse: [
      { overMin: 100_000, overMax: 206_700, rate: 0.22, subtractAmount: 10_172.0 },
      { overMin: 206_700, overMax: 394_600, rate: 0.24, subtractAmount: 14_306.0 },
      { overMin: 394_600, overMax: 501_050, rate: 0.32, subtractAmount: 45_874.0 },
      { overMin: 501_050, overMax: 751_600, rate: 0.35, subtractAmount: 60_905.5 },
      { overMin: 751_600, overMax: Infinity, rate: 0.37, subtractAmount: 75_937.5 },
    ],
    married_filing_separately: [
      { overMin: 100_000, overMax: 103_350, rate: 0.22, subtractAmount: 5_086.0 },
      { overMin: 103_350, overMax: 197_300, rate: 0.24, subtractAmount: 7_153.0 },
      { overMin: 197_300, overMax: 250_525, rate: 0.32, subtractAmount: 22_937.0 },
      { overMin: 250_525, overMax: 375_800, rate: 0.35, subtractAmount: 30_452.75 },
      { overMin: 375_800, overMax: Infinity, rate: 0.37, subtractAmount: 37_968.75 },
    ],
    head_of_household: [
      { overMin: 100_000, overMax: 103_350, rate: 0.22, subtractAmount: 6_825.0 },
      { overMin: 103_350, overMax: 197_300, rate: 0.24, subtractAmount: 8_892.0 },
      { overMin: 197_300, overMax: 250_500, rate: 0.32, subtractAmount: 24_676.0 },
      { overMin: 250_500, overMax: 626_350, rate: 0.35, subtractAmount: 32_191.0 },
      { overMin: 626_350, overMax: Infinity, rate: 0.37, subtractAmount: 44_718.0 },
    ],
  },
};

const SCHEDULES_BY_YEAR: Record<number, RateScheduleTable> = {
  2025: SCHEDULE_2025_FEDERAL,
};

/**
 * Compute tax via the Tax Computation Worksheet. Caller is responsible
 * for ensuring `taxableIncome ≥ 100_000` — below that the IRS instructs
 * use of the Tax Table, not the rate schedule. We throw on a below-$100k
 * caller because that's a programming error.
 *
 * The IRS rounds tax to whole dollars; we leave the un-rounded result to
 * the caller (the renderer rounds at write time via fmtMoney).
 */
export function lookupRateSchedule(
  taxYear: number,
  filingStatus: FilingStatus,
  taxableIncome: number,
): number {
  const table = SCHEDULES_BY_YEAR[taxYear];
  if (!table) {
    throw new Error(
      `No rate schedule loaded for tax year ${taxYear}. Available: ${Object.keys(SCHEDULES_BY_YEAR).join(", ")}.`,
    );
  }
  const rows = table.byStatus[filingStatus];
  if (!rows) {
    throw new Error(
      `Filing status "${filingStatus}" has no rate schedule in the ${taxYear} table.`,
    );
  }
  if (taxableIncome < 100_000) {
    throw new Error(
      `lookupRateSchedule called with taxableIncome=${taxableIncome} < $100,000. Use lookupTax (Tax Table) instead — the IRS only publishes the rate schedule for ≥ $100,000.`,
    );
  }
  for (const r of rows) {
    if (taxableIncome > r.overMin && taxableIncome <= r.overMax) {
      return taxableIncome * r.rate - r.subtractAmount;
    }
  }
  throw new Error(
    `Tax computation worksheet: no row matched taxableIncome=${taxableIncome} for ${filingStatus} in ${taxYear}.`,
  );
}
