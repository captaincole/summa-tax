// Alex Morales — expected results.
//
// Every numeric expected value below is the literal number from the
// perfect Alex 1040 (the user's reference Alex-1040-Finished.pdf, kept
// outside the repo). Any divergence between the rendered 1040 and these
// values is a regression in the engine, catalog, bindings, FilingInfo
// resolver, or renderer.

import type { ExpectedResults } from "../../types.js";

export const alexExpected: ExpectedResults = {
  // Engine-computed line values (numeric). The runner asserts each against
  // the evaluated form's typed numeric result.
  engineFields: {
    "form-1040.line.1a": 79000,    // total W-2 wages box 1
    "form-1040.line.1z": 79000,    // sum of 1a..1h
    "form-1040.line.9": 79000,     // total income
    "form-1040.line.11b": 79000,   // AGI (page 2 display)
    "form-1040.line.12e": 15750,   // 2025 single standard deduction
    "form-1040.line.14": 15750,
    "form-1040.line.15": 63250,    // taxable income
    "form-1040.line.16": 8835,     // tax — from 2025 IRS Tax Table
    "form-1040.line.18": 8835,
    "form-1040.line.22": 8835,
    "form-1040.line.24": 8835,     // total tax
    "form-1040.line.25a": 9420,    // W-2 box 2 federal withholding
    "form-1040.line.25d": 9420,
    "form-1040.line.33": 9420,     // total payments
    "form-1040.line.34": 585,       // refund (9,420 − 8,835)
    "form-1040.line.37": 0,         // owed
  },

  // PDF widget text values. Money fields render as integer strings via
  // fmtMoney. SSN gets separator-stripped by the renderer because the PDF
  // widget is 9-char digit-only (`maxLength=9`).
  renderedText: {
    "form-1040.header.first_name_mi": "Alex",
    "form-1040.header.last_name": "Morales",
    "form-1040.header.ssn": "123456789", // stripped from "123-45-6789"
    "form-1040.header.home_address": "2245 Lakeshore Ave",
    "form-1040.header.city": "Oakland",
    "form-1040.header.state": "CA",
    "form-1040.header.zip": "94606",
    "form-1040.line.16": "8,835",
    "form-1040.line.34": "585",
    "form-1040.signing.taxpayer_occupation": "Engineer",
    "form-1040.signing.taxpayer_phone": "7039530253",
    "form-1040.signing.taxpayer_email": "alex@morales.com",
  },

  // Header dates the binding leaves blank for calendar-year filers.
  renderedBlank: [
    "form-1040.header.tax_year_beginning_mm",
    "form-1040.header.tax_year_ending_mm",
    "form-1040.header.tax_year_ending_yy",
  ],

  // Checkboxes that must end up checked. Filing status is now 5 separate
  // boolean fields; only the matching one (Single for Alex) gets checked.
  renderedChecked: [
    "form-1040.header.filing_status_single",
  ],
};
