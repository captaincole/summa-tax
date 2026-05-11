// Form 1040 — U.S. Individual Income Tax Return (2025) bindings.
//
// Phase B: this file declares only the *behavior* layer. Field inventory
// (label, category, valueType, position) lives in
// `fixtures/forms/form-1040-2025.json` and will be mirrored into the
// `forms` / `form_fields` Supabase tables for the AI pipeline staging
// path. The engine joins these two halves at evaluation time.
//
// Phase D will overwrite this file with AI-generated bindings; Phase E
// diffs the two as the validation ratchet for the pipeline.

import { bindMustFile, bindField } from "../engine.js";
import * as r from "../rules/index.js";

bindMustFile("form-1040", r.lookupDecision, {
  decisionKey: "decisions.scope.must_file_federal",
});

// ─── Header — personal info + filing scope ───
// Derived from identity facts and the filing-status decision so the Filing
// Status panel knows whether the form's top-of-form info is complete.
// PDF rendering still reads raw facts directly.

bindField("form-1040", "form-1040.header.first_name", r.lookupFact, {
  factKey: "identity.name.first",
});

bindField("form-1040", "form-1040.header.last_name", r.lookupFact, {
  factKey: "identity.name.last",
});

bindField("form-1040", "form-1040.header.ssn", r.lookupFact, {
  factKey: "identity.ssn",
});

bindField("form-1040", "form-1040.header.address", r.lookupFact, {
  factKey: "identity.address",
});

bindField("form-1040", "form-1040.header.filing_status", r.lookupDecision, {
  decisionKey: "decisions.scope.filing_status",
});

// ─── Wages from W-2s ───

// Line 1a — Total amount from Form(s) W-2, box 1
bindField("form-1040", "form-1040.line.1a", r.sumFacts, {
  category: "wages",
  keyPrefix: "employer.",
  fieldPath: "box1",
});

// Line 1z — Add lines 1a through 1h (only 1a populated for now). When 1b–1h
// land, add them as additional terms.
bindField("form-1040", "form-1040.line.1z", r.fromFields, {
  terms: [
    { formId: "form-1040", fieldId: "form-1040.line.1a", sign: 1 },
  ],
  rationale: "Currently only line 1a is populated.",
});

// ─── Dividends from 1099-DIVs ───

// Line 3a — Qualified dividends (1099-DIV box 1b)
bindField("form-1040", "form-1040.line.3a", r.sumFacts, {
  category: "investment_income",
  keyPrefix: "account.",
  fieldPath: "box1b",
});

// Line 3b — Ordinary dividends (1099-DIV box 1a)
bindField("form-1040", "form-1040.line.3b", r.sumFacts, {
  category: "investment_income",
  keyPrefix: "account.",
  fieldPath: "box1a",
});

// ─── Capital gain/(loss) ───
// TODO(Phase F): once Schedule D is reintroduced, rebind to:
//   r.fromFields with terms = [{
//     formId: "schedule-d",
//     fieldId: "schedule-d.line.16",
//     sign: 1,
//     whenSourceNotRequired: 0,
//   }]
// For Phase A/B, Schedule D isn't registered so line 7 is just zero.
bindField("form-1040", "form-1040.line.7", r.constant, {
  value: 0,
  rationale: "Schedule D disabled in Phase A/B; restored in Phase F.",
});

// Line 9 — Total income (1z + 3b + 7)
bindField("form-1040", "form-1040.line.9", r.fromFields, {
  terms: [
    { formId: "form-1040", fieldId: "form-1040.line.1z", sign: 1 },
    { formId: "form-1040", fieldId: "form-1040.line.3b", sign: 1 },
    { formId: "form-1040", fieldId: "form-1040.line.7", sign: 1 },
  ],
  rationale: "Sum of lines 1z, 3b, 7 (only ones populated for this return).",
});

// Line 10 — Adjustments to income (Schedule 1). Zero for MVP.
bindField("form-1040", "form-1040.line.10", r.constant, {
  value: 0,
  rationale: "No Schedule 1 adjustments for this return.",
});

// Line 11 — AGI (9 − 10)
bindField("form-1040", "form-1040.line.11", r.fromFields, {
  terms: [
    { formId: "form-1040", fieldId: "form-1040.line.9", sign: 1 },
    { formId: "form-1040", fieldId: "form-1040.line.10", sign: -1 },
  ],
  rationale: "Line 9 minus line 10.",
});

// ─── Standard deduction (line 12) ───
// 2025 federal standard deductions, keyed on filing status.
const STD_DEDUCTION_2025: Record<string, number> = {
  single: 15000,
  married_filing_jointly: 30000,
  married_filing_separately: 15000,
  head_of_household: 22500,
  qualifying_surviving_spouse: 30000,
};

bindField("form-1040", "form-1040.line.12", r.tableLookupByDecision, {
  decisionKey: "decisions.scope.filing_status",
  table: STD_DEDUCTION_2025,
});

// Line 13 — QBI deduction. Zero for MVP.
bindField("form-1040", "form-1040.line.13", r.constant, {
  value: 0,
  rationale: "No QBI deduction for this return.",
});

// Line 14 — 12 + 13
bindField("form-1040", "form-1040.line.14", r.fromFields, {
  terms: [
    { formId: "form-1040", fieldId: "form-1040.line.12", sign: 1 },
    { formId: "form-1040", fieldId: "form-1040.line.13", sign: 1 },
  ],
  rationale: "Standard deduction + QBI.",
});

// Line 15 — Taxable income (11 − 14, not less than 0)
bindField("form-1040", "form-1040.line.15", r.fromFields, {
  terms: [
    { formId: "form-1040", fieldId: "form-1040.line.11", sign: 1 },
    { formId: "form-1040", fieldId: "form-1040.line.14", sign: -1 },
  ],
  floor: 0,
  rationale: "AGI minus deductions, floored at zero.",
});

// ─── Tax (line 16) ─── 2025 federal ordinary brackets.
// Single only for now — matches the original form1040.ts which always used
// single brackets regardless of filing status. Other statuses will block
// with "no bracket table for X" until populated. TODO: add MFJ/MFS/HoH/QSS
// brackets when a scenario forces them.
const ORDINARY_BRACKETS_2025: Record<
  string,
  Array<{ upTo: number; rate: number }>
> = {
  single: [
    { upTo: 11_925, rate: 0.10 },
    { upTo: 48_475, rate: 0.12 },
    { upTo: 103_350, rate: 0.22 },
    { upTo: 197_300, rate: 0.24 },
    { upTo: 250_525, rate: 0.32 },
    { upTo: 626_350, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
};

bindField("form-1040", "form-1040.line.16", r.bracketLookup, {
  decisionKey: "decisions.scope.filing_status",
  inputFieldId: "form-1040.line.15",
  brackets: ORDINARY_BRACKETS_2025,
});

// Line 23 — Other taxes (Schedule 2). Zero for MVP.
bindField("form-1040", "form-1040.line.23", r.constant, {
  value: 0,
  rationale: "No other taxes.",
});

// Line 24 — Total tax (16 + 23)
bindField("form-1040", "form-1040.line.24", r.fromFields, {
  terms: [
    { formId: "form-1040", fieldId: "form-1040.line.16", sign: 1 },
    { formId: "form-1040", fieldId: "form-1040.line.23", sign: 1 },
  ],
  rationale: "Tax + other taxes.",
});

// Line 25a — Federal income tax withheld from W-2 box 2
bindField("form-1040", "form-1040.line.25a", r.sumFacts, {
  category: "wages",
  keyPrefix: "employer.",
  fieldPath: "box2",
});

// Line 33 — Total payments (currently just 25a)
bindField("form-1040", "form-1040.line.33", r.fromFields, {
  terms: [
    { formId: "form-1040", fieldId: "form-1040.line.25a", sign: 1 },
  ],
  rationale: "Currently only line 25a contributes.",
});

// Line 34 — Amount overpaid (refund). max(0, 33 − 24).
bindField("form-1040", "form-1040.line.34", r.fromFields, {
  terms: [
    { formId: "form-1040", fieldId: "form-1040.line.33", sign: 1 },
    { formId: "form-1040", fieldId: "form-1040.line.24", sign: -1 },
  ],
  floor: 0,
  rationale: "Refund: payments minus tax, floored at zero.",
});

// Line 37 — Amount you owe. max(0, 24 − 33).
bindField("form-1040", "form-1040.line.37", r.fromFields, {
  terms: [
    { formId: "form-1040", fieldId: "form-1040.line.24", sign: 1 },
    { formId: "form-1040", fieldId: "form-1040.line.33", sign: -1 },
  ],
  floor: 0,
  rationale: "Balance due: tax minus payments, floored at zero.",
});
