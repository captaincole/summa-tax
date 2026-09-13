// Standard-deduction lookup table, keyed by (jurisdiction, taxYear,
// filingStatus). Parallel structure to forms/data/taxTable.ts — both are
// per-jurisdiction reference data that bindings call inline.
//
// Bindings call this rather than carrying inline literals so that:
//   - Annual amount updates land in one file, not N bindings
//   - Adding a new jurisdiction (state-NY, state-OR, …) means appending
//     one entry, not editing every state form's bindings
//
// Sources:
//   - federal 2025: IRS Rev. Proc. 2024-40 (inflation adjustments for 2025).
//     Also printed on Form 1040 Instructions page 32.
//   - state-ca 2025: FTB 540 instructions, Schedule X.

import type { FilingStatus } from "../values.js";

interface StandardDeductionTable {
  jurisdiction: string;
  taxYear: number;
  byFilingStatus: Record<FilingStatus, number>;
  source: { url?: string; note: string };
}

const TABLES: StandardDeductionTable[] = [
  {
    jurisdiction: "federal",
    taxYear: 2025,
    byFilingStatus: {
      single: 15750,
      married_filing_separately: 15750,
      married_filing_jointly: 31500,
      qualifying_surviving_spouse: 31500,
      head_of_household: 23625,
    },
    source: {
      url: "https://www.irs.gov/pub/irs-pdf/i1040gi.pdf",
      note: "Form 1040 Instructions, 2025 Standard Deduction table",
    },
  },
  {
    jurisdiction: "state-ca",
    taxYear: 2025,
    byFilingStatus: {
      single: 5706,
      married_filing_separately: 5706,
      married_filing_jointly: 11412,
      qualifying_surviving_spouse: 11412,
      head_of_household: 11412,
    },
    source: {
      note: "CA FTB Form 540 2025 Instructions — standard deduction",
    },
  },
];

/**
 * Look up the standard deduction for a (jurisdiction, year, filingStatus)
 * tuple. Returns undefined when no table is loaded for that combination —
 * lets bindings short-circuit to undefined (blocks the field) rather than
 * silently using a wrong default.
 *
 * Doesn't currently handle the dependent / blind / 65+ worksheet (the
 * adjustments that bump the basic standard deduction). Those scenarios
 * aren't ingested yet; bind that worksheet when they are.
 */
export function lookupStandardDeduction(
  jurisdiction: string,
  taxYear: number,
  filingStatus: FilingStatus,
): number | undefined {
  const table = TABLES.find(
    (t) => t.jurisdiction === jurisdiction && t.taxYear === taxYear,
  );
  return table?.byFilingStatus[filingStatus];
}
