// Alejandro Reyes — CA Form 540 expected results.
//
// Every numeric expected value below is the literal number from
// `docs/Alejandro-CA540-Golden.pdf` in this scenario folder. Any divergence is a
// regression in the engine, catalog, bindings, FilingInfo resolver, or
// renderer.
//
// Known gaps that will surface as failures until upstream bindings land:
//   - line.13_federal_agi reads f["form-1040.line.11b"], which depends on
//     federal 1040 line 7a (Schedule D) flowing through correctly. Until
//     the Schedule D binding lands, federal AGI is short by $2,550 and
//     every downstream CA line is wrong.
//   - line.31_tax_amount uses lookupTax(ca-2025, …). Once the upstream
//     taxable income is correct ($97,229), this should produce $5,478
//     directly — CA doesn't apply the QDCG worksheet, qualified divs
//     and LTCG are ordinary at CA rates.

import type { ExpectedResults } from "../../types.js";

export const alejandro540Expected: ExpectedResults = {
  engineFields: {
    // Exemptions — single filer, no blind/senior/dependents.
    "form-540.line.7_personal_exemption_count": 1,
    "form-540.line.7_personal_exemption_amount": 153,
    "form-540.line.11_total_exemption_amount": 153,

    // Taxable income block
    "form-540.line.12_state_wages": 100_000,
    "form-540.line.13_federal_agi": 102_935,
    "form-540.line.14_ca_adjustments_subtractions": 0,
    "form-540.line.15_ca_agi_before_additions": 102_935,
    "form-540.line.16_ca_adjustments_additions": 0,
    "form-540.line.17_ca_agi": 102_935,
    "form-540.line.18_deductions": 5_706,
    "form-540.line.19_taxable_income": 97_229,

    // Tax
    "form-540.line.31_tax_amount": 5_478,
    "form-540.line.32_exemption_credits": 153,
    "form-540.line.33_tax_after_exemption_credits": 5_325,
    "form-540.line.35_total_tax_after_credits": 5_325,
    "form-540.line.48_tax_after_credits": 5_325,
    "form-540.line.64_total_tax": 5_325,

    // Payments — CA withholding from W-2 box 17.
    "form-540.line.71_ca_income_tax_withheld": 5_500,
    "form-540.line.78_total_payments": 5_500,

    // Use tax
    "form-540.line.91_use_tax": 0,

    // Overpaid / refund
    "form-540.line.93_payments_balance": 5_500,
    "form-540.line.95_payments_after_isr_penalty": 5_500,
    "form-540.line.97_overpaid_tax": 175,
    "form-540.line.99_overpaid_tax_available": 175,
    "form-540.line.115_refund_or_no_amount_due": 175,
  },

  renderedText: {
    "form-540.header.first_name": "Alejandro",
    "form-540.header.last_name": "Reyes",
    "form-540.header.ssn": "234567890",
    "form-540.header.home_address": "123 Valencia Street",
    "form-540.header.city": "San Francisco",
    "form-540.header.state": "CA",
    "form-540.header.zip": "94110",
    "form-540.header.county_at_filing": "San Francisco",
    "form-540.header.date_of_birth": "01/02/2003",
    "form-540.signing.taxpayer_email": "alejandro@reyes.com",
    "form-540.signing.taxpayer_phone": "4156369589",
    // Lines bound via sums that produce 0 — render as "0" because the
    // engine produces a numeric ok result.
    "form-540.line.96_isr_penalty_balance": "0",
    "form-540.line.100_tax_due": "0",
    "form-540.line.110_total_contributions": "0",
    "form-540.line.111_amount_you_owe": "0",
  },

  renderedBlank: [
    // Spouse — single, no spouse facts.
    "form-540.header.spouse_first_name",
    "form-540.header.spouse_last_name",
    "form-540.header.spouse_ssn",
    // No dependents.
    "form-540.dependents.dep1_first_name",
    "form-540.dependents.dep1_last_name",
    "form-540.dependents.dep1_ssn",
    // Lines bound unsupported — same set as Alex.
    "form-540.line.34_tax_amount",
    "form-540.line.40_child_dependent_care_credit",
    "form-540.line.46_renters_credit",
    "form-540.line.61_alternative_minimum_tax",
    "form-540.line.62_behavioral_health_services_tax",
    "form-540.line.72_ca_estimated_tax_payments",
    "form-540.line.73_withholding_592b_593",
    "form-540.line.98_applied_to_2026_estimated_tax",
  ],

  renderedChecked: [
    "form-540.header.filing_status",                 // Single (radio group)
    "form-540.header.mailing_same_as_residence",     // mailing == principal
    "form-540.line.91_no_use_tax_owed",              // "No use tax is owed"
    "form-540.line.92_full_year_health_coverage",    // full-year MEC
  ],
};
