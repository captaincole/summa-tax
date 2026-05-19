// Alejandro Reyes — expected 1040 results.
//
// Every numeric expected value below is the literal number from the
// CPA-completed `docs/Alejandro-1040-Golden.pdf` in this scenario folder.
// Any divergence is a regression in the engine, catalog, bindings,
// FilingInfo resolver, or renderer.
//
// Known gaps Alejandro will surface vs. current bindings:
//   - line.7a (capital gain) — currently "unsupported"; needs Schedule D
//     binding to produce $2,550. Until then, the sum on line 9 will be
//     short by $2,550 and every downstream line will be wrong.
//   - line.16 (tax) — currently uses lookupTax(taxable_income, status);
//     Alejandro's preferential income ($381 qualified divs + $2,250 net
//     LTCG = $2,631) requires the Qualified Dividends and Capital Gain
//     Tax Worksheet to compute correctly ($13,916). Plain tax-table
//     lookup at $87,185 gives a different (wrong) answer.

import type { ExpectedResults } from "../../types.js";

export const alejandroExpected: ExpectedResults = {
  engineFields: {
    "form-1040.line.1a": 100000,    // total W-2 wages box 1
    "form-1040.line.1z": 100000,    // sum of 1a..1h
    "form-1040.line.3a": 381,        // qualified dividends (1099-DIV box 1b)
    "form-1040.line.3b": 385,        // ordinary dividends (1099-DIV box 1a)
    "form-1040.line.7a": 2550,      // net capital gain (Schedule D line 16)
    "form-1040.line.9": 102935,     // total income
    "form-1040.line.11a": 102935,   // AGI (page 1 display)
    "form-1040.line.11b": 102935,   // AGI (page 2 display) — also flows to CA 540 line 13
    "form-1040.line.12e": 15750,    // 2025 single standard deduction
    "form-1040.line.14": 15750,
    "form-1040.line.15": 87185,     // taxable income
    "form-1040.line.16": 13916,     // tax via QDCG worksheet (NOT plain tax-table)
    "form-1040.line.18": 13916,
    "form-1040.line.22": 13916,
    "form-1040.line.24": 13916,     // total tax
    "form-1040.line.25a": 14500,    // W-2 box 2 federal withholding
    "form-1040.line.25d": 14500,
    "form-1040.line.33": 14500,     // total payments
    "form-1040.line.34": 584,        // refund (14,500 − 13,916)
    "form-1040.line.37": 0,          // owed
  },

  renderedText: {
    "form-1040.header.first_name_mi": "Alejandro",
    "form-1040.header.last_name": "Reyes",
    "form-1040.header.ssn": "234567890", // stripped from "234-56-7890"
    "form-1040.header.home_address": "123 Valencia Street",
    "form-1040.header.city": "San Francisco",
    "form-1040.header.state": "CA",
    "form-1040.header.zip": "94110",
    "form-1040.line.16": "13,916",
    "form-1040.line.34": "584",
    "form-1040.signing.taxpayer_occupation": "marketing",
    "form-1040.signing.taxpayer_phone": "4156369589",
    "form-1040.signing.taxpayer_email": "alejandro@reyes.com",
  },

  renderedBlank: [
    // Calendar-year filer — no fiscal-year header dates.
    "form-1040.header.tax_year_beginning_mm",
    "form-1040.header.tax_year_ending_mm",
    "form-1040.header.tax_year_ending_yy",
    // Direct-deposit bank info: we have no banking facts ingested yet,
    // so the routing + account-number widgets must stay blank. (The
    // original CPA-supplied golden had "stuff" placeholder text in
    // both; we cleaned that up and now this assertion guards the
    // regression.)
    "form-1040.line.35b_routing_number",
    "form-1040.line.35d_account_number",
  ],

  renderedChecked: [
    "form-1040.header.filing_status_single",
  ],
};
