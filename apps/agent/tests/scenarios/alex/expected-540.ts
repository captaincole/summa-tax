// Alex Morales — CA Form 540 expected results.
//
// Every numeric expected value below is the literal number from the CPA-
// completed Alex-CA540-Golden.pdf in this scenario's docs/ folder. Any
// divergence between the rendered 540 and these values is a regression in
// the engine, catalog, bindings, FilingInfo resolver, or renderer.
//
// FieldIds are pulled from the live catalog at
// `ref/forms/state/ca/form-540-2025.catalog.json`. When the catalog is
// re-ingested, fieldId renames surface as compile errors in the typed
// bindings (Form540 interface no longer matches) and as runtime
// mismatches here in the expected file.

import type { ExpectedResults } from "../../types.js";

export const alex540Expected: ExpectedResults = {
  engineFields: {
    // Exemptions. Catalog now exposes line 7 as TWO fields: `_count` (the
    // exemption count widget — 1 for single/MFS/HOH, 2 for MFJ/QSS) and
    // `_amount` (count × $153, the dollar amount that rolls into line 11).
    // The new typed bindings handle both cleanly.
    "form-540.line.7_personal_exemption_count": 1,
    "form-540.line.7_personal_exemption_amount": 153,
    "form-540.line.11_total_exemption_amount": 153,

    // Taxable income block
    "form-540.line.12_state_wages": 79000,
    "form-540.line.13_federal_agi": 79000,
    "form-540.line.14_ca_adjustments_subtractions": 0,
    "form-540.line.15_ca_agi_before_additions": 79000,
    "form-540.line.16_ca_adjustments_additions": 0,
    "form-540.line.17_ca_agi": 79000,
    "form-540.line.18_deductions": 5706,
    "form-540.line.19_taxable_income": 73294,

    // Tax
    "form-540.line.31_tax_amount": 3256,
    "form-540.line.32_exemption_credits": 153,
    "form-540.line.33_tax_after_exemption_credits": 3103,
    "form-540.line.35_total_tax_after_credits": 3103,
    "form-540.line.48_tax_after_credits": 3103,
    "form-540.line.64_total_tax": 3103,

    // Payments
    "form-540.line.71_ca_income_tax_withheld": 3100,
    "form-540.line.78_total_payments": 3100,

    // Use tax
    "form-540.line.91_use_tax": 0,

    // Overpaid / due
    "form-540.line.93_payments_balance": 3100,
    "form-540.line.95_payments_after_isr_penalty": 3100,
    "form-540.line.100_tax_due": 3,
    "form-540.line.111_amount_you_owe": 3,
  },

  renderedText: {
    "form-540.header.first_name": "Alex",
    "form-540.header.last_name": "Morales",
    "form-540.header.ssn": "123456789",
    "form-540.header.home_address": "2245 Lakeshore Ave",
    "form-540.header.apartment": "Apt 3",
    "form-540.header.city": "Oakland",
    "form-540.header.state": "CA",
    "form-540.header.zip": "94606",
    "form-540.header.county_at_filing": "Alameda",
    "form-540.header.date_of_birth": "01/01/2002",
    "form-540.signing.taxpayer_email": "alex@morales.com",
    "form-540.signing.taxpayer_phone": "7039530253",
    // Lines bound via fromFields that genuinely produce 0 for Alex (the
    // refund-branch reads them and clamps): line 97 (overpaid), 99
    // (overpaid available), 115 (refund). Alex owes $3 so these are
    // zero but still applicable.
    "form-540.line.97_overpaid_tax": "0",
    "form-540.line.99_overpaid_tax_available": "0",
    "form-540.line.115_refund_or_no_amount_due": "0",
  },

  renderedBlank: [
    // Spouse fields — Alex is Single, no spouse facts.
    "form-540.header.spouse_first_name",
    "form-540.header.spouse_last_name",
    "form-540.header.spouse_ssn",
    // Dependents — none for Alex.
    "form-540.dependents.dep1_first_name",
    "form-540.dependents.dep1_last_name",
    "form-540.dependents.dep1_ssn",
    // Lines bound `unsupported` — Schedule G-1, AMT, CDCC, renter's
    // credit, BHST, estimated payments, etc. Engine doesn't compute them,
    // so the renderer leaves them blank (semantically equivalent to "0"
    // on the form — IRS/FTB accept either).
    "form-540.line.34_tax_amount",
    "form-540.line.40_child_dependent_care_credit",
    "form-540.line.46_renters_credit",
    "form-540.line.61_alternative_minimum_tax",
    "form-540.line.62_behavioral_health_services_tax",
    "form-540.line.72_ca_estimated_tax_payments",
    "form-540.line.73_withholding_592b_593",
    "form-540.line.98_applied_to_2026_estimated_tax",
    // ISR penalty / total contributions — categorically unsupported
    // scenarios, render blank per the broader policy.
    "form-540.line.96_isr_penalty_balance",
    "form-540.line.110_total_contributions",
  ],

  renderedChecked: [
    "form-540.header.filing_status",                 // Single (radio group)
    "form-540.header.mailing_same_as_residence",     // mailing == principal
    "form-540.line.91_no_use_tax_owed",              // "No use tax is owed"
    "form-540.line.92_full_year_health_coverage",    // full-year MEC
  ],
};
