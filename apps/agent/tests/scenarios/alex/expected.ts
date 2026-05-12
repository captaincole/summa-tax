// Alex Morales — expected results.
//
// Every numeric expected value below is the literal number from the
// perfect Alex 1040 (the user's reference Alex-1040-Finished.pdf, kept
// outside the repo). Any divergence between the rendered 1040 and these
// values is a regression in the engine, rules, catalog, bindings, or
// renderer.

import type { ExpectedResults } from "../../types.js";

export const alexExpected: ExpectedResults = {
  // Engine-computed line values (numeric). The runner asserts each against
  // the evaluated form's typed numeric result.
  engineFields: {
    "form-1040.line.1a": 79_000,    // total W-2 wages box 1
    "form-1040.line.1z": 79_000,    // sum of 1a..1h
    "form-1040.line.9": 79_000,     // total income
    "form-1040.line.11b": 79_000,   // AGI (page 2 display)
    "form-1040.line.12e": 15_750,   // 2025 single standard deduction
    "form-1040.line.14": 15_750,
    "form-1040.line.15": 63_250,    // taxable income
    "form-1040.line.16": 8_835,     // tax — from 2025 IRS Tax Table
    "form-1040.line.18": 8_835,
    "form-1040.line.22": 8_835,
    "form-1040.line.24": 8_835,     // total tax
    "form-1040.line.25a": 9_420,    // W-2 box 2 federal withholding
    "form-1040.line.25d": 9_420,
    "form-1040.line.33": 9_420,     // total payments
    "form-1040.line.34": 585,       // refund (9,420 − 8,835)
    "form-1040.line.37": 0,         // owed
  },

  // PDF widget text values. Money fields render as integer strings via
  // fmtMoney. SSN gets separator-stripped by the renderer because the PDF
  // widget is 9-char digit-only (`maxLength=9`).
  renderedText: {
    "form-1040.header.first_name": "Alex",
    "form-1040.header.last_name": "Morales",
    "form-1040.header.ssn": "123456789", // stripped from "123-45-6789"
    "form-1040.header.address_street": "2245 Lakeshore Ave",
    "form-1040.header.address_city": "Oakland",
    "form-1040.header.address_state": "CA",
    "form-1040.header.address_zip": "94606",
    "form-1040.line.16": "8835",
    "form-1040.line.34": "585",
    "form-1040.signing.taxpayer_occupation": "Engineer",
    "form-1040.signing.taxpayer_phone": "703-953-0253",
    "form-1040.signing.taxpayer_email": "rand@wheeloftime.com",
  },

  // Header dates the binding leaves blank for calendar-year filers.
  renderedBlank: [
    "form-1040.header.tax_year_begin",
    "form-1040.header.tax_year_end",
    "form-1040.header.tax_year_end_year",
  ],

  // Multi_select fields that must end up with at least one checked option.
  renderedChecked: [
    "form-1040.header.filing_status", // filing_status decision → single checkbox
  ],
};
