// Marcus Chen — Schedule A expected results.
//
// Numbers below mirror `docs/Marcus-ScheduleA-Golden.pdf` (CPA-prepared,
// 2026-05-26). Marcus's Schedule A is SALT-only:
//   - $15,500 state income tax (W-2 box 17)
//   - $2,922 CA SDI (W-2 box 14, deductible as state income tax)
//   - = $18,422 total SALT, fully under the 2025 OBBBA $40,000 cap
// No medical, mortgage, charity, or other itemized lines for this profile.

import type { ExpectedResults } from "../../types.js";

export const marcusScheduleAExpected: ExpectedResults = {
  engineFields: {
    "schedule-a.0.line.5a_state_local_income_or_sales_tax": 18422,
    "schedule-a.0.line.5d_total_state_local_taxes": 18422,
    "schedule-a.0.line.5e_salt_cap": 18422,
    "schedule-a.0.line.7_total_taxes": 18422,
    "schedule-a.0.line.17_total_itemized_deductions": 18422,
  },

  renderedText: {
    "schedule-a.0.header.taxpayer_name": "Marcus Chen",
    // SSN renders with dashes via the per-form SSN.format override in
    // bindings.ts (Schedule A's widget isn't a comb widget the way the
    // 1040's is).
    "schedule-a.0.header.ssn": "345-67-8901",
    "schedule-a.0.line.5a_state_local_income_or_sales_tax": "18,422",
    "schedule-a.0.line.5d_total_state_local_taxes": "18,422",
    "schedule-a.0.line.5e_salt_cap": "18,422",
    "schedule-a.0.line.7_total_taxes": "18,422",
    "schedule-a.0.line.17_total_itemized_deductions": "18,422",
  },

  renderedBlank: [
    // No medical → lines 2/3/4 suppressed per IRS instructions ("skip
    // lines 2 through 4 if line 1 is blank"). Worth pinning so a future
    // regression that re-emits AGI here gets caught.
    "schedule-a.0.line.1_medical_dental_expenses",
    "schedule-a.0.line.2_agi_from_1040",
    "schedule-a.0.line.3_agi_multiplied",
    "schedule-a.0.line.4_net_medical_dental",
    "schedule-a.0.line.5b_real_estate_taxes",
    "schedule-a.0.line.5c_personal_property_taxes",
    "schedule-a.0.line.8a_mortgage_interest_form1098",
    "schedule-a.0.line.8e_total_mortgage_interest_points",
    "schedule-a.0.line.10_total_interest",
    "schedule-a.0.line.11_gifts_cash_check",
    "schedule-a.0.line.12_gifts_other_than_cash",
    "schedule-a.0.line.14_total_gifts",
  ],

  renderedChecked: [],
};
