// Static tax tables. Keep these pure data so tests can import them
// independently and so yearly updates are a single-file diff.

export type FilingStatus = "single" | "mfj" | "mfs" | "hoh" | "qss";

// 2025 standard deduction (post-TCJA, indexed).
// Source: Rev. Proc. 2024-40.
export const STANDARD_DEDUCTION_2025: Record<FilingStatus, number> = {
  single: 15000,
  mfj: 30000,
  mfs: 15000,
  hoh: 22500,
  qss: 30000,
};

// 2025 federal ordinary income tax brackets. Each entry: [upperBound, rate].
// The upperBound is the top of the bracket (inclusive). A final entry uses
// Infinity for the open-top bracket.
export type Bracket = { upTo: number; rate: number };

export const BRACKETS_2025: Record<FilingStatus, Bracket[]> = {
  single: [
    { upTo: 11925,  rate: 0.10 },
    { upTo: 48475,  rate: 0.12 },
    { upTo: 103350, rate: 0.22 },
    { upTo: 197300, rate: 0.24 },
    { upTo: 250525, rate: 0.32 },
    { upTo: 626350, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  mfj: [
    { upTo: 23850,  rate: 0.10 },
    { upTo: 96950,  rate: 0.12 },
    { upTo: 206700, rate: 0.22 },
    { upTo: 394600, rate: 0.24 },
    { upTo: 501050, rate: 0.32 },
    { upTo: 751600, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  mfs: [
    { upTo: 11925,  rate: 0.10 },
    { upTo: 48475,  rate: 0.12 },
    { upTo: 103350, rate: 0.22 },
    { upTo: 197300, rate: 0.24 },
    { upTo: 250525, rate: 0.32 },
    { upTo: 375800, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  hoh: [
    { upTo: 17000,  rate: 0.10 },
    { upTo: 64850,  rate: 0.12 },
    { upTo: 103350, rate: 0.22 },
    { upTo: 197300, rate: 0.24 },
    { upTo: 250500, rate: 0.32 },
    { upTo: 626350, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  qss: [
    { upTo: 23850,  rate: 0.10 },
    { upTo: 96950,  rate: 0.12 },
    { upTo: 206700, rate: 0.22 },
    { upTo: 394600, rate: 0.24 },
    { upTo: 501050, rate: 0.32 },
    { upTo: 751600, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
};

// 2025 Saver's Credit (Form 8880) AGI limits, by filing status.
// Tuples are (upperAGIinclusive → creditRate).
export type SaversCreditTier = { maxAgi: number; rate: number };

export const SAVERS_CREDIT_2025: Record<FilingStatus, SaversCreditTier[]> = {
  single: [
    { maxAgi: 23750, rate: 0.50 },
    { maxAgi: 25750, rate: 0.20 },
    { maxAgi: 39500, rate: 0.10 },
  ],
  mfj: [
    { maxAgi: 47500, rate: 0.50 },
    { maxAgi: 51500, rate: 0.20 },
    { maxAgi: 79000, rate: 0.10 },
  ],
  mfs: [
    { maxAgi: 23750, rate: 0.50 },
    { maxAgi: 25750, rate: 0.20 },
    { maxAgi: 39500, rate: 0.10 },
  ],
  hoh: [
    { maxAgi: 35625, rate: 0.50 },
    { maxAgi: 38625, rate: 0.20 },
    { maxAgi: 59250, rate: 0.10 },
  ],
  qss: [
    { maxAgi: 47500, rate: 0.50 },
    { maxAgi: 51500, rate: 0.20 },
    { maxAgi: 79000, rate: 0.10 },
  ],
};

// Apply a bracketed tax schedule to a taxable-income amount.
// Returns the total tax owed, using standard progressive math.
export function computeBracketedTax(taxableIncome: number, brackets: Bracket[]): number {
  if (taxableIncome <= 0) return 0;
  let remaining = taxableIncome;
  let tax = 0;
  let lastUpTo = 0;
  for (const { upTo, rate } of brackets) {
    const bracketSize = upTo - lastUpTo;
    const taxedAtThisRate = Math.min(remaining, bracketSize);
    tax += taxedAtThisRate * rate;
    remaining -= taxedAtThisRate;
    lastUpTo = upTo;
    if (remaining <= 0) break;
  }
  return Math.round(tax * 100) / 100;
}
