// Parser for the California FTB Tax Table (2025 540 booklet appendix). FTB
// publishes the table as a PDF only; we extract text via unpdf and split
// each row by whitespace.
//
// CA Tax Table differs from the IRS table in two ways that matter here:
//   - 5 numeric columns per row (low, high, single_or_mfs, mfj_or_qss, hoh)
//     vs. IRS's 6 columns. CA combines Single+MFS into one column and
//     MFJ+QSS into another (those pairs always pay the same tax).
//   - Row width is $100 instead of $50, and the first row covers $1..$50.
//
// Each text line is one row. The header repeats across pages; we filter by
// shape — exactly 5 comma-formatted integers per line that satisfy
// low < high.

import { extractText } from "unpdf";

export interface CATaxTableRow {
  low: number;
  high: number;
  single_or_mfs: number;
  mfj_or_qss: number;
  hoh: number;
}

export interface CAParseResult {
  rows: CATaxTableRow[];
  diagnostics: {
    pagesInspected: number;
    linesInspected: number;
    linesAccepted: number;
    linesRejected: number;
  };
}

// FTB renders the very first row with dollar-sign prefixes ($1 $50 $0 $0
// $0) — accept optional "$" on each cell so the lowest band parses.
const ROW_RE = /^\$?([\d,]+)\s+\$?([\d,]+)\s+\$?([\d,]+)\s+\$?([\d,]+)\s+\$?([\d,]+)$/;

export async function parseCATaxTable(pdfBytes: Uint8Array): Promise<CAParseResult> {
  const result = await extractText(pdfBytes);
  const rows: CATaxTableRow[] = [];
  const diagnostics: CAParseResult["diagnostics"] = {
    pagesInspected: result.totalPages,
    linesInspected: 0,
    linesAccepted: 0,
    linesRejected: 0,
  };

  for (const page of result.text) {
    for (const rawLine of page.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      diagnostics.linesInspected++;
      const m = line.match(ROW_RE);
      if (!m) {
        diagnostics.linesRejected++;
        continue;
      }
      const nums = [m[1], m[2], m[3], m[4], m[5]].map(parseIntCell);
      if (nums.some((n) => n === null)) {
        diagnostics.linesRejected++;
        continue;
      }
      const [low, high, single_or_mfs, mfj_or_qss, hoh] = nums as number[];
      if (low >= high) {
        diagnostics.linesRejected++;
        continue;
      }
      rows.push({ low, high, single_or_mfs, mfj_or_qss, hoh });
      diagnostics.linesAccepted++;
    }
  }

  return { rows, diagnostics };
}

function parseIntCell(raw: string): number | null {
  const s = raw.replace(/,/g, "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

// ─── Coverage validation ─────────────────────────────────────────────────

export interface CACoverageReport {
  ok: boolean;
  minIncome: number;
  maxIncome: number;
  rowCount: number;
  gaps: { after: number; before: number }[];
  overlaps: { row: CATaxTableRow; previousHigh: number }[];
}

/**
 * Validates that rows form a contiguous sweep from $1 to ~$100,000. FTB's
 * convention is "at_least..but_not_over" with the upper bound EXCLUSIVE in
 * the next row's "at_least" — i.e. row N's `high` should equal row N+1's
 * `low` MINUS 1 (because "but_not_over $50" + next row "at_least $51"
 * means $50 belongs to the first row). We normalize to standard
 * half-open intervals at the call-site by treating `high` as inclusive.
 */
export function validateCACoverage(rows: CATaxTableRow[]): CACoverageReport {
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
  const gaps: CACoverageReport["gaps"] = [];
  const overlaps: CACoverageReport["overlaps"] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    // FTB: prev.high = 50, cur.low = 51 → contiguous (no gap)
    if (cur.low > prev.high + 1) gaps.push({ after: prev.high, before: cur.low });
    else if (cur.low <= prev.high) overlaps.push({ row: cur, previousHigh: prev.high });
  }
  return {
    ok: gaps.length === 0 && overlaps.length === 0 && rows[0].low === 1,
    minIncome: rows[0].low,
    maxIncome: rows[rows.length - 1].high,
    rowCount: rows.length,
    gaps,
    overlaps,
  };
}
