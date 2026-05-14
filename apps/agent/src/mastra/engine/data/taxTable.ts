// Runtime loader for tax tables (Form 1040 line 16 / Form 540 line 31, for
// taxable income under $100,000). Each table is identified by a stable
// `tableId` (e.g. "federal-2025", "ca-2025"). Per-table JSON files live
// next to this file; adding a new jurisdiction or tax year = add a JSON +
// import line below.
//
// Tables differ in column count and which filing statuses share columns
// (federal has 4, CA has 3 with Single+MFS and MFJ+QSS each sharing one).
// Each JSON carries its own `filingStatusColumns` map so the rule code
// stays jurisdiction-agnostic.

import federal2025 from "./tax-table-2025.json" with { type: "json" };
import ca2025 from "./ca-tax-table-2025.json" with { type: "json" };

export type FilingStatus =
  | "single"
  | "married_filing_jointly"
  | "married_filing_separately"
  | "head_of_household"
  | "qualifying_surviving_spouse";

// A row's column-value lookups are jurisdiction-specific (federal uses
// "single"/"mfj"/"mfs"/"hoh"; CA uses "single_or_mfs"/"mfj_or_qss"/"hoh").
// Treat per-row values as a string-keyed map and resolve via the table's
// own filingStatusColumns mapping at lookup time.
export interface TaxTableRow {
  low: number;
  high: number;
  [columnName: string]: number;
}

/**
 * "half_open" → row covers [low, high) and row.high === next.low (federal).
 * "inclusive" → row covers [low, high] and row.high + 1 === next.low (CA).
 */
export type BoundaryConvention = "half_open" | "inclusive";

interface LoadedTaxTable {
  tableId: string;
  taxYear: number;
  jurisdiction: string;
  source: {
    url: string;
    fetchedAt: string;
    sha256: string;
    cacheFile: string;
  };
  coverage: { minIncome: number; maxIncome: number; rowCount: number };
  boundaryConvention: BoundaryConvention;
  filingStatusColumns: Record<string, string>;
  rows: TaxTableRow[];
}

const TABLES_BY_ID: Record<string, LoadedTaxTable> = {
  "federal-2025": federal2025 as LoadedTaxTable,
  "ca-2025": ca2025 as LoadedTaxTable,
};

export interface TaxTableLookupOk {
  ok: true;
  tax: number;
  bracket: { low: number; high: number };
  /** Provenance, useful for AI rationale / Nynaeve grounding. */
  source: { tableId: string; taxYear: number; jurisdiction: string; url: string };
}

export interface TaxTableLookupErr {
  ok: false;
  reason:
    | "table_not_supported"
    | "filing_status_not_supported"
    | "out_of_range"
    | "invalid_input";
  message: string;
}

export type TaxTableLookupResult = TaxTableLookupOk | TaxTableLookupErr;

/**
 * Look up tax for (tableId, taxableIncome, filingStatus). Returns a
 * discriminated result — callers handle each failure mode explicitly.
 */
export function lookupTax(
  tableId: string,
  taxableIncome: number,
  filingStatus: FilingStatus,
): TaxTableLookupResult {
  const table = TABLES_BY_ID[tableId];
  if (!table) {
    return {
      ok: false,
      reason: "table_not_supported",
      message: `No tax table loaded for tableId "${tableId}". Available: ${Object.keys(TABLES_BY_ID).join(", ")}.`,
    };
  }
  const column = table.filingStatusColumns[filingStatus];
  if (!column) {
    return {
      ok: false,
      reason: "filing_status_not_supported",
      message: `Filing status "${filingStatus}" has no column mapping in table "${tableId}".`,
    };
  }
  if (!Number.isFinite(taxableIncome)) {
    return {
      ok: false,
      reason: "invalid_input",
      message: `Taxable income must be finite; got ${taxableIncome}.`,
    };
  }
  if (taxableIncome < 0) {
    return {
      ok: false,
      reason: "out_of_range",
      message: `Taxable income ${taxableIncome} is negative.`,
    };
  }
  if (taxableIncome > table.coverage.maxIncome) {
    return {
      ok: false,
      reason: "out_of_range",
      message: `Taxable income ${taxableIncome} is above the tax-table ceiling of $${table.coverage.maxIncome} for ${tableId}. Use the appropriate tax-rate schedule / computation worksheet instead.`,
    };
  }
  const row = findRow(table.rows, taxableIncome, table.boundaryConvention);
  if (!row) {
    return {
      ok: false,
      reason: "out_of_range",
      message: `No tax-table row matched income ${taxableIncome} in ${tableId} — coverage gap in the JSON.`,
    };
  }
  const tax = row[column];
  if (typeof tax !== "number") {
    return {
      ok: false,
      reason: "invalid_input",
      message: `Row for income ${taxableIncome} in ${tableId} is missing column "${column}".`,
    };
  }
  return {
    ok: true,
    tax,
    bracket: { low: row.low, high: row.high },
    source: {
      tableId: table.tableId,
      taxYear: table.taxYear,
      jurisdiction: table.jurisdiction,
      url: table.source.url,
    },
  };
}

// Linear scan with early exit. Tables are sorted by low ascending; bail as
// soon as we pass the target. The federal table has 2062 rows, CA has 1001
// — well under any threshold where binary search would matter.
function findRow(
  rows: TaxTableRow[],
  income: number,
  convention: BoundaryConvention,
): TaxTableRow | undefined {
  const includesHigh = (high: number): boolean =>
    convention === "inclusive" ? income <= high : income < high;
  for (const r of rows) {
    if (income >= r.low && includesHigh(r.high)) return r;
    if (r.low > income) return undefined;
  }
  return undefined;
}

/** Available tableIds, useful for diagnostic output. */
export function supportedTableIds(): string[] {
  return Object.keys(TABLES_BY_ID).sort();
}
