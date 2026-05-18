// Alejandro Reyes — facts (the "data").
//
// Sourced from `apps/agent/tests/scenarios/alejandro/docs/01-alejandro-w2.pdf`
// (Pacific Software W-2) and `02-alejandro-1099.pdf` (Apex Securities 1099
// consolidated statement: 1099-DIV + 1099-B). Identity facts come from
// the W-2 / 1099 plus normal intake. Alejandro is the next step up from
// Alex's clean W-2 case — he has investment income (dividends + capital
// gain distributions from stock sales) that exercises the QDCG worksheet
// on 1040 line 16 and the Schedule D / 8949 chain on line 7a.

import type { TaxFactRow } from "../../../src/mastra/db/taxFacts.js";
import {
  makeDividendFactKey,
  makeTradeFactKey,
  makeW2FactKey,
  type DividendFactValue,
  type TradeFactValue,
  type W2FactValue,
} from "../../../src/mastra/facts/index.js";
import { identityFact } from "../../helpers/fixtureBuilders.js";

export const ALEJANDRO_USER_ID = "alejandro-integration";
export const ALEJANDRO_TAX_YEAR = 2025;

const w2: W2FactValue = {
  employerName: "Pacific Software, Inc.",
  employerEin: "47-8901234",
  employerAddress: {
    line1: "600 Townsend Street",
    city: "San Francisco",
    state: "CA",
    zip: "94103",
  },
  box1: 100000,
  box2: 14500,
  box3: 100000,
  box4: 6200,
  box5: 100000,
  box6: 1450,
  box14: [{ label: "CA SDI", amount: 1100 }],
  box15: "CA",
  box16: 100000,
  box17: 5500,
};

const div: DividendFactValue = {
  payerName: "Apex Securities, Inc.",
  payerTin: "13-2345678",
  box1a: 385.20,
  box1b: 381.40,
};

// NVDA short-term trade — Form 8949 Part I (Box A, basis reported).
const nvdaTrade: TradeFactValue = {
  tradeId: "nvda-2025-11-20",
  description: "NVIDIA CORP",
  cusip: "67066G104",
  symbol: "NVDA",
  quantity: 10,
  dateAcquired: "02/10/25",
  dateSold: "11/20/25",
  proceeds: 1650,
  costBasis: 1350,
};

// AAPL long-term trade — Form 8949 Part II (Box D, basis reported).
const aaplTrade: TradeFactValue = {
  tradeId: "aapl-2025-09-15",
  description: "APPLE INC",
  cusip: "037833100",
  symbol: "AAPL",
  quantity: 50,
  dateAcquired: "06/15/23",
  dateSold: "09/15/25",
  proceeds: 11500,
  costBasis: 9250,
};

const idFact = (suffix: string, value: string) =>
  identityFact({
    userId: ALEJANDRO_USER_ID,
    taxYear: ALEJANDRO_TAX_YEAR,
    suffix,
    value,
  });

export const alejandroFacts: TaxFactRow[] = [
  idFact("name.first", "Alejandro"),
  idFact("name.last", "Reyes"),
  idFact("ssn", "234-56-7890"),
  idFact("dob", "01/02/2003"),
  idFact("address.street", "123 Valencia Street"),
  idFact("address.city", "San Francisco"),
  idFact("address.state", "CA"),
  idFact("address.zip", "94110"),
  idFact("address.county", "San Francisco"),
  idFact("occupation", "marketing"),
  idFact("phone", "415-636-9589"),
  idFact("email", "alejandro@reyes.com"),
  {
    id: "f-w2",
    userId: ALEJANDRO_USER_ID,
    taxYear: ALEJANDRO_TAX_YEAR,
    category: "wages",
    key: makeW2FactKey("pacific-software"),
    value: w2,
    sourceNote: "W-2 from Pacific Software, Inc.",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-div-apex",
    userId: ALEJANDRO_USER_ID,
    taxYear: ALEJANDRO_TAX_YEAR,
    category: "investment_income",
    key: makeDividendFactKey("apex-individual"),
    value: div,
    sourceNote: "Apex Securities 1099-DIV (account 4471-029-883).",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-trade-nvda",
    userId: ALEJANDRO_USER_ID,
    taxYear: ALEJANDRO_TAX_YEAR,
    category: "investment_income",
    key: makeTradeFactKey("apex-individual", nvdaTrade.tradeId),
    value: nvdaTrade,
    sourceNote: "Apex Securities 1099-B (NVDA short-term covered).",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-trade-aapl",
    userId: ALEJANDRO_USER_ID,
    taxYear: ALEJANDRO_TAX_YEAR,
    category: "investment_income",
    key: makeTradeFactKey("apex-individual", aaplTrade.tradeId),
    value: aaplTrade,
    sourceNote: "Apex Securities 1099-B (AAPL long-term covered).",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-mec",
    userId: ALEJANDRO_USER_ID,
    taxYear: ALEJANDRO_TAX_YEAR,
    category: "health_coverage",
    key: "health_coverage.full_year_mec",
    value: true,
    sourceNote: "Verbal confirmation during intake — employer-provided plan covered all 12 months of 2025.",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-use-tax",
    userId: ALEJANDRO_USER_ID,
    taxYear: ALEJANDRO_TAX_YEAR,
    category: "use_tax",
    key: "use_tax.owed_amount",
    value: 0,
    sourceNote: "Verbal confirmation during intake — no out-of-state online purchases requiring use tax.",
    createdAt: "2026-04-29T00:00:00Z",
  },
];
