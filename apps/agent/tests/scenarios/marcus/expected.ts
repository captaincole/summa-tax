// Marcus Chen — Form 1040 expected results (Schedule A PR scope).
//
// Limited to the lines that prove Schedule A integrated correctly:
// line 12e flips from the standard-deduction lookup to Schedule A
// line 17 ($18,422). Other 1040 lines (2b interest, 3b dividends,
// 7a capital gain, line 23 additional taxes) light up as the
// remaining form bindings land — no goldenPdfPath here yet because
// the full 1040 won't match the CPA's golden until those PRs ship.

import type { ExpectedResults } from "../../types.js";

export const marcusExpected: ExpectedResults = {
  engineFields: {
    "form-1040.line.1a": 220000,
    "form-1040.line.1z": 220000,
    "form-1040.line.9": 220000,
    "form-1040.line.11b": 220000,
    // Itemized: Schedule A line 17, not the standard deduction.
    "form-1040.line.12e": 18422,
    "form-1040.line.14": 18422,
    "form-1040.line.15": 201578, // 220,000 − 18,422
  },

  renderedText: {
    "form-1040.header.first_name_mi": "Marcus",
    "form-1040.header.last_name": "Chen",
    // 1040 SSN is a comb widget → digits-only per the federal default.
    "form-1040.header.ssn": "345678901",
  },

  renderedBlank: [],

  renderedChecked: [
    "form-1040.header.filing_status_single",
  ],
};
