// Structured spec for Scenario 03 — Investments (Dividends Only).
// Narrative lives in 03-investments-dividends.md; this file is the
// machine-readable ground truth used by the fixtures pipeline and downstream
// tests.
//
// When these diverge, the .ts wins for rendering and the .md wins for intent.
// Keep them synced.

import type { ScenarioSpec } from "../pipeline/types.js"

export const scenario: ScenarioSpec = {
  id: "03-investments-dividends",
  taxYear: 2025,
  taxpayer: {
    name: { first: "Alejandro", last: "Reyes" },
    ssn: "234-56-7890",
    address: {
      line1: "123 Valencia Street",
      city: "San Francisco",
      state: "CA",
      zip: "94110",
    },
  },
  documents: [
    {
      kind: "W-2",
      outputFilename: "03-alejandro-w2.pdf",
      employer: {
        name: "Pacific Software, Inc.",
        ein: "47-8901234",
        address: {
          line1: "600 Townsend Street",
          city: "San Francisco",
          state: "CA",
          zip: "94103",
        },
      },
      boxes: {
        box1: 100000.00,
        box2: 14500.00,
        box3: 100000.00,
        box4: 6200.00,
        box5: 100000.00,
        box6: 1450.00,
        box13: { retirementPlan: false },
        box14: [{ label: "CA SDI", amount: 1100.00 }],
        box15: "CA",
        box16: 100000.00,
        box17: 5500.00,
      },
    },
    {
      kind: "1099-Consolidated",
      outputFilename: "03-alejandro-1099.pdf",
      payer: {
        name: "Apex Securities, Inc.",
        tin: "13-2345678",
        phone: "800-555-0100",
        address: {
          line1: "1 Market Street, Suite 3000",
          city: "San Francisco",
          state: "CA",
          zip: "94105",
        },
      },
      accountNumber: "4471-029-883",
      div: {
        box1a: 385.20,
        box1b: 381.40,
        box2a: 0,
        box3: 0,
        box4: 0,
        box5: 0,
        box7: 0,
        box12: 0,
      },
      // INT/MISC/OID present-but-empty: brokers print these sections with
      // $0.00 across the board, so we mirror that by including the keys
      // with no values populated.
      int: {},
      misc: {},
      oid: {},
      // 1099-B summary — Alejandro made two sales in 2025: one long-term
      // and one short-term, both fully covered (basis reported to IRS).
      // Numbers below tie out to bDetail subtotals.
      b: {
        proceeds: 13150.00,
        proceedsCovered: 13150.00,
        proceedsNoncovered: 0,
        costBasisCovered: 10600.00,
        accruedMarketDiscount: 0,
        washSaleLossDisallowed: 0,
        federalIncomeTaxWithheld: 0,
      },
      divDetail: [
        { description: "VANGUARD S&P 500 ETF", cusip: "922908363", payDate: "03/31/25", ordinaryDividends: 93.40, qualifiedDividends: 92.50 },
        { description: "VANGUARD S&P 500 ETF", cusip: "922908363", payDate: "06/30/25", ordinaryDividends: 94.20, qualifiedDividends: 93.20 },
        { description: "VANGUARD S&P 500 ETF", cusip: "922908363", payDate: "09/30/25", ordinaryDividends: 96.10, qualifiedDividends: 94.80 },
        { description: "VANGUARD S&P 500 ETF", cusip: "922908363", payDate: "12/22/25", ordinaryDividends: 101.50, qualifiedDividends: 100.90 },
      ],
      bDetail: [
        // Long-term covered: bought AAPL in 2023, sold a chunk in 2025.
        // Held >1 year → Form 8949 Part II Box D, taxed at LTCG rate.
        {
          section: "long-covered",
          description: "APPLE INC",
          cusip: "037833100",
          symbol: "AAPL",
          quantity: 50,
          dateAcquired: "06/15/23",
          dateSold: "09/15/25",
          proceeds: 11500.00,
          costBasis: 9250.00,
          gainLoss: 2250.00,
        },
        // Short-term covered: bought NVDA Feb 2025, sold Nov 2025.
        // Held <1 year → Form 8949 Part I Box A, taxed at ordinary rate.
        {
          section: "short-covered",
          description: "NVIDIA CORP",
          cusip: "67066G104",
          symbol: "NVDA",
          quantity: 10,
          dateAcquired: "02/10/25",
          dateSold: "11/20/25",
          proceeds: 1650.00,
          costBasis: 1350.00,
          gainLoss: 300.00,
        },
      ],
    },
  ],
}

export default scenario
