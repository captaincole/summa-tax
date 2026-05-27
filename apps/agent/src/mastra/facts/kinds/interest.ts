// 1099-INT fact kind. One fact = one payer's full 1099-INT box totals.
// Mirrors the 1099-DIV pattern (see dividends.ts) — same category, same
// per-payer key shape, same parse/get helpers.
//
// Convention:
//   category: "investment_income"
//   key:      "account.{accountSlug}.interest"
//   value:    InterestFactValue
//
// TODO: Schedule B Part I requires per-payer rows when total interest
// exceeds $1,500. Each fact already represents one payer, so the data
// shape is right — the binding side just needs a repeating-row mechanism
// that doesn't exist yet (same problem Schedule B / Schedule D capital
// gains rows hit). Until that lands, Schedule B Part I stays unsupported.

import type { FactsView } from "../../engine/types.js";
import type { TaxFactRow } from "../../db/taxFacts.js";

export interface InterestFactValue {
  payerName: string;
  payerTin?: string;
  // 1099-INT box totals — all optional. Box 1 is the load-bearing field
  // (taxable interest income, flows to 1040 line 2b). Other boxes only
  // populate when specific situations apply.
  box1?: number;   // Interest income
  box2?: number;   // Early withdrawal penalty (an above-the-line deduction)
  box3?: number;   // US savings bond and Treasury interest
  box4?: number;   // Federal income tax withheld
  box5?: number;   // Investment expenses
  box6?: number;   // Foreign tax paid
  box7?: string;   // Foreign country or US territory
  box8?: number;   // Tax-exempt interest (flows to 1040 line 2a)
  box9?: number;   // Specified private activity bond interest (AMT-relevant)
  box10?: number;  // Market discount
  box11?: number;  // Bond premium
  box12?: number;  // Bond premium on Treasury obligations
  box13?: number;  // Bond premium on tax-exempt bonds
  box15?: string;  // State
  box16?: string;  // State identification number
  box17?: number;  // State income tax withheld
}

export interface InterestFact {
  accountSlug: string;
  interest: InterestFactValue;
  sourceFact: TaxFactRow;
}

const INT_CATEGORY = "investment_income";
const INT_KEY_RE = /^account\.([^.]+)\.interest$/;

export function makeInterestFactKey(accountSlug: string): string {
  return `account.${accountSlug}.interest`;
}

/**
 * True when this key is a 1099-INT fact key. Used by the resolver to
 * filter `sumInvestmentBox` reads so 1099-INT box totals don't get
 * confused with 1099-DIV box totals that happen to share a numeric
 * suffix (box4 federal withholding is shared by design; box1 is INT-only
 * but the filter still protects against future overlap).
 */
export function isInterestFactKey(key: string): boolean {
  return INT_KEY_RE.test(key);
}

export function isInterestFact(f: TaxFactRow): boolean {
  return f.category === INT_CATEGORY && INT_KEY_RE.test(f.key);
}

export function parseInterestFact(f: TaxFactRow): InterestFact | null {
  if (f.category !== INT_CATEGORY) return null;
  const match = f.key.match(INT_KEY_RE);
  if (!match) return null;
  const [, accountSlug] = match;
  return {
    accountSlug,
    interest: f.value as InterestFactValue,
    sourceFact: f,
  };
}

export function getInterestFacts(facts: FactsView): InterestFact[] {
  const out: InterestFact[] = [];
  for (const f of facts.byCategory(INT_CATEGORY)) {
    const parsed = parseInterestFact(f);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}
