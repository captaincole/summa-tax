// Trade fact kind. Each row in a 1099-B (a single sale) is stored as one
// tax_facts row under category "investment_income" with a structured value.
//
// Convention (lives ONLY here — never spell out the regex elsewhere):
//   category: "investment_income"
//   key:      "account.{accountSlug}.trades.{tradeId}"
//   value:    TradeFactValue
//
// Reads call `getTradeFacts(facts)`. Writes call `makeTradeFactKey(slug, id)`
// to build the key, paired with the typed value. Both sides reference the
// same conventions so they can't drift.

import type { FactsView } from "../../types.js";
import type { TaxFactRow } from "../rows.js";

export interface TradeFactValue {
  tradeId: string;
  description: string;             // "APPLE INC"
  cusip?: string;
  symbol?: string;
  quantity: number;
  dateAcquired: string;            // "MM/DD/YY" as printed on the 1099-B
  dateSold: string;
  proceeds: number;
  costBasis: number;
  adjustmentCode?: string;         // Form 8949 column (f), optional
  adjustmentAmount?: number;       // column (g), optional
}

/** Parsed view of a trade fact: the structured value plus the components
 *  extracted from the key, plus the underlying TaxFactRow for source-note
 *  tracking. */
export interface TradeFact {
  accountSlug: string;
  tradeId: string;
  trade: TradeFactValue;
  sourceFact: TaxFactRow;
}

const TRADE_CATEGORY = "investment_income";
const TRADE_KEY_RE = /^account\.([^.]+)\.trades\.([^.]+)$/;

/** Build the canonical fact key for a trade. Use this in ingest tools
 *  rather than concatenating the string by hand. */
export function makeTradeFactKey(accountSlug: string, tradeId: string): string {
  return `account.${accountSlug}.trades.${tradeId}`;
}

/** True iff this row is a trade fact under our convention. */
export function isTradeFact(f: TaxFactRow): boolean {
  return f.category === TRADE_CATEGORY && TRADE_KEY_RE.test(f.key);
}

/** Parse one TaxFactRow as a trade fact. Returns null when the row's
 *  category or key shape don't match. Trusts the value shape (no runtime
 *  validation yet — relies on ingest going through typed helpers). */
export function parseTradeFact(f: TaxFactRow): TradeFact | null {
  if (f.category !== TRADE_CATEGORY) return null;
  const match = f.key.match(TRADE_KEY_RE);
  if (!match) return null;
  const [, accountSlug, tradeId] = match;
  return {
    accountSlug,
    tradeId,
    trade: f.value as TradeFactValue,
    sourceFact: f,
  };
}

/** All trade facts for the current taxpayer, parsed and typed. */
export function getTradeFacts(facts: FactsView): TradeFact[] {
  const out: TradeFact[] = [];
  for (const f of facts.byCategory(TRADE_CATEGORY)) {
    const parsed = parseTradeFact(f);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}
