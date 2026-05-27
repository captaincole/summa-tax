// Marcus Chen — Form 8959 expected results.
//
// Mirror of `docs/Marcus-8959-Golden.pdf` (CPA-prepared). Marcus's
// Additional Medicare Tax comes entirely from W-2 Medicare wages — no
// SE income, no RRTA. Part I lines 1–7 fire; Parts II/III stay blank.
// Part V reconciles employer withholding (W-2 box 6 includes both 1.45%
// regular Medicare and the 0.9% Additional Medicare on wages above $200k):
//
//   Box 5 Medicare wages           $243,500
//   Single-filer threshold        −$200,000
//   Excess wages                    $43,500
//   Additional Medicare Tax (0.9%)  $   392    ← line 7 / line 18
//
//   Box 6 Medicare tax withheld     $ 3,922
//   1.45% × box 5                  −$ 3,531
//   Add'l Medicare withholding      $   391    ← line 22 / line 24

import type { ExpectedResults } from "../../types.js";

export const marcus8959Expected: ExpectedResults = {
  engineFields: {
    "form-8959.0.line.1_medicare_wages_tips": 243500,
    "form-8959.0.line.4_total_medicare_wages": 243500,
    "form-8959.0.line.5_filing_status_threshold_wages": 200000,
    "form-8959.0.line.6_excess_medicare_wages": 43500,
    "form-8959.0.line.7_additional_medicare_tax_wages": 392,
    "form-8959.0.line.18_total_additional_medicare_tax": 392,
    "form-8959.0.line.19_medicare_tax_withheld": 3922,
    "form-8959.0.line.20_medicare_wages_from_line1": 243500,
    "form-8959.0.line.21_regular_medicare_tax_on_wages": 3531,
    "form-8959.0.line.22_additional_medicare_tax_withholding_wages": 391,
    "form-8959.0.line.24_total_additional_medicare_tax_withholding": 391,
  },

  renderedText: {
    "form-8959.0.header.taxpayer_name": "Marcus Chen",
    "form-8959.0.header.ssn": "345-67-8901",
    "form-8959.0.line.1_medicare_wages_tips": "243,500",
    "form-8959.0.line.4_total_medicare_wages": "243,500",
    "form-8959.0.line.5_filing_status_threshold_wages": "200,000",
    "form-8959.0.line.6_excess_medicare_wages": "43,500",
    "form-8959.0.line.7_additional_medicare_tax_wages": "392",
    "form-8959.0.line.18_total_additional_medicare_tax": "392",
    "form-8959.0.line.19_medicare_tax_withheld": "3,922",
    "form-8959.0.line.20_medicare_wages_from_line1": "243,500",
    "form-8959.0.line.21_regular_medicare_tax_on_wages": "3,531",
    "form-8959.0.line.22_additional_medicare_tax_withholding_wages": "391",
    "form-8959.0.line.24_total_additional_medicare_tax_withholding": "391",
  },

  // Parts II (SE) and III (RRTA) blank — Marcus has neither.
  renderedBlank: [
    "form-8959.0.line.8_self_employment_income",
    "form-8959.0.line.9_filing_status_threshold_se",
    "form-8959.0.line.10_medicare_wages_from_line4",
    "form-8959.0.line.11_threshold_reduced_by_wages",
    "form-8959.0.line.12_excess_se_income",
    "form-8959.0.line.13_additional_medicare_tax_se",
    "form-8959.0.line.14_rrta_compensation_tips",
    "form-8959.0.line.15_filing_status_threshold_rrta",
    "form-8959.0.line.16_excess_rrta_compensation",
    "form-8959.0.line.17_additional_medicare_tax_rrta",
    "form-8959.0.line.23_additional_medicare_tax_withholding_rrta",
  ],

  renderedChecked: [],
};
