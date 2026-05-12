// Parser for the IRS Pub 17 Tax Table (publication 17, "Your Federal Income
// Tax", section "2025 Tax Table"). The IRS publishes the same numbers as
// the i1040gi.pdf Tax Table but in actual HTML tables — much easier to
// parse reliably than positional PDF text.
//
// The page contains MANY tables (standard-deduction worksheets, EIC tables,
// etc.). We recognize a "tax table chunk" by its shape:
//   - 6 numeric columns: low, high, single, mfj, mfs, hoh
//   - thead text mentions "If line 15" or "taxable income" + "Your tax is"
//
// The full tax table is split across many of these chunks (one per $1000 of
// income, mirroring the PDF's page layout). We concatenate them in document
// order, then validate coverage from 0 to $100,000 with no gaps.

import { load, type CheerioAPI } from "cheerio";

export interface TaxTableRow {
  low: number;
  high: number;
  single: number;
  mfj: number;
  mfs: number;
  hoh: number;
}

export interface ParseResult {
  rows: TaxTableRow[];
  diagnostics: {
    tablesInspected: number;
    tablesAccepted: number;
    tablesRejected: { reason: string; sample?: string }[];
  };
}

const TAX_TABLE_HEADER_CLUES = [
  /\bif line 1\d\b/i, // "If line 15" in 2025, may shift year-to-year
  /\btaxable income\b/i,
  /\byour tax is\b/i,
];

export function parseTaxTable(html: string): ParseResult {
  const $ = load(html);
  const diagnostics: ParseResult["diagnostics"] = {
    tablesInspected: 0,
    tablesAccepted: 0,
    tablesRejected: [],
  };

  const rows: TaxTableRow[] = [];

  $("table").each((_, el) => {
    diagnostics.tablesInspected++;
    const $table = $(el);
    if (!looksLikeTaxTable($, $table)) {
      // Don't record a per-table reason for everything that isn't a tax
      // table — the page has dozens of unrelated tables.
      return;
    }
    const collected = extractRows($, $table);
    if (collected.rows.length === 0) {
      diagnostics.tablesRejected.push({
        reason: "tax-table-shaped but produced zero parsable rows",
        sample: $table.find("tbody tr").first().text().trim().slice(0, 120),
      });
      return;
    }
    diagnostics.tablesAccepted++;
    rows.push(...collected.rows);
  });

  return { rows, diagnostics };
}

// ─── Heuristics ──────────────────────────────────────────────────────────

function looksLikeTaxTable($: CheerioAPI, $table: ReturnType<CheerioAPI>): boolean {
  const headText = $table.find("thead").text().toLowerCase();
  if (!headText) return false;
  const cluesMatched = TAX_TABLE_HEADER_CLUES.filter((rx) => rx.test(headText));
  if (cluesMatched.length < 2) return false;

  // Confirm body shape: at least one row with exactly 6 td's whose contents
  // all parse as non-negative integers (possibly comma-formatted).
  const $firstBodyRow = $table.find("tbody > tr").first();
  if ($firstBodyRow.length === 0) return false;
  const cells = $firstBodyRow.find("td");
  if (cells.length !== 6) return false;
  for (let i = 0; i < cells.length; i++) {
    if (parseIntCell($(cells[i]).text()) === null) return false;
  }
  return true;
}

// ─── Row extraction ──────────────────────────────────────────────────────

function extractRows(
  $: CheerioAPI,
  $table: ReturnType<CheerioAPI>,
): { rows: TaxTableRow[] } {
  const rows: TaxTableRow[] = [];
  $table.find("tbody > tr").each((_, tr) => {
    const cells = $(tr).find("td");
    if (cells.length !== 6) return;
    const nums = [0, 1, 2, 3, 4, 5].map((i) => parseIntCell($(cells[i]).text()));
    if (nums.some((n) => n === null)) return;
    const [low, high, single, mfj, mfs, hoh] = nums as number[];
    if (low >= high) return; // malformed range — skip
    rows.push({ low, high, single, mfj, mfs, hoh });
  });
  return { rows };
}

function parseIntCell(raw: string): number | null {
  const s = raw.replace(/[\s,]/g, "").trim();
  if (s === "") return null;
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// ─── Coverage validation ─────────────────────────────────────────────────

export interface CoverageReport {
  ok: boolean;
  minIncome: number;
  maxIncome: number;
  rowCount: number;
  gaps: { after: number; before: number }[];
  overlaps: { row: TaxTableRow; previousHigh: number }[];
}

/**
 * Asserts the extracted rows cover [0, maxIncome) contiguously with no gaps
 * or overlaps. The IRS table covers 0..100,000 in $50 increments for the
 * higher bands and $25/$10/$5 increments for the lowest band — but the
 * one invariant is "row[i].high === row[i+1].low" all the way down.
 */
export function validateCoverage(rows: TaxTableRow[]): CoverageReport {
  if (rows.length === 0) {
    return {
      ok: false,
      minIncome: 0,
      maxIncome: 0,
      rowCount: 0,
      gaps: [],
      overlaps: [],
    };
  }
  const gaps: CoverageReport["gaps"] = [];
  const overlaps: CoverageReport["overlaps"] = [];
  let prev = rows[0];
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i];
    if (cur.low > prev.high) gaps.push({ after: prev.high, before: cur.low });
    else if (cur.low < prev.high) overlaps.push({ row: cur, previousHigh: prev.high });
    prev = cur;
  }
  return {
    ok: gaps.length === 0 && overlaps.length === 0 && rows[0].low === 0,
    minIncome: rows[0].low,
    maxIncome: rows[rows.length - 1].high,
    rowCount: rows.length,
    gaps,
    overlaps,
  };
}
