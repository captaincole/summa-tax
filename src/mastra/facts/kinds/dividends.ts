// 1099-DIV fact kind. The per-account 1099-DIV summary (box totals) is
// stored as one tax_facts row. Per-payment dividend detail (used by some
// brokers and useful for Schedule B itemization above the $1,500 threshold)
// would be a separate kind — not modeled here yet.
//
// Convention:
//   category: "investment_income"
//   key:      "account.{accountSlug}.dividends"
//   value:    DividendFactValue

import type { FactsView } from "../../forms/types.js";
import type { TaxFactRow } from "../../db/taxFacts.js";

export interface DividendFactValue {
  payerName: string;
  payerTin?: string;
  // 1099-DIV box totals — all optional except 1a/1b which are the common
  // case. Other boxes only populate when specific situations apply.
  box1a?: number;   // Total ordinary dividends
  box1b?: number;   // Qualified dividends
  box2a?: number;   // Total capital gain distributions
  box2b?: number;   // Unrecap. Sec. 1250 gain
  box2d?: number;   // Collectibles (28%) gain
  box3?: number;    // Non-dividend distributions
  box4?: number;    // Federal income tax withheld
  box5?: number;    // Section 199A dividends
  box6?: number;    // Investment expenses
  box7?: number;    // Foreign tax paid
  box9?: number;    // Cash liquidation distributions
  box10?: number;   // Non-cash liquidation distributions
  box12?: number;   // Exempt-interest dividends
  box13?: number;   // Specified private activity bond interest dividends
}

export interface DividendFact {
  accountSlug: string;
  dividends: DividendFactValue;
  sourceFact: TaxFactRow;
}

const DIV_CATEGORY = "investment_income";
const DIV_KEY_RE = /^account\.([^.]+)\.dividends$/;

export function makeDividendFactKey(accountSlug: string): string {
  return `account.${accountSlug}.dividends`;
}

export function isDividendFact(f: TaxFactRow): boolean {
  return f.category === DIV_CATEGORY && DIV_KEY_RE.test(f.key);
}

export function parseDividendFact(f: TaxFactRow): DividendFact | null {
  if (f.category !== DIV_CATEGORY) return null;
  const match = f.key.match(DIV_KEY_RE);
  if (!match) return null;
  const [, accountSlug] = match;
  return {
    accountSlug,
    dividends: f.value as DividendFactValue,
    sourceFact: f,
  };
}

export function getDividendFacts(facts: FactsView): DividendFact[] {
  const out: DividendFact[] = [];
  for (const f of facts.byCategory(DIV_CATEGORY)) {
    const parsed = parseDividendFact(f);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}
