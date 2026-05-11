// Form 1040 — U.S. Individual Income Tax Return (2025)
//
// Hand-written in the Phase A style. Phase D will overwrite this file
// with AI-generated bindings; Phase E diffs the two as the validation
// ratchet for the AI pipeline.
//
// Inventory (label, category, valueType) lives inline in each bindField
// call during Phase A. Phase B moves inventory rows into Supabase
// `form_fields` and bindField's signature drops the inventory arg; the
// behavior layer (rule + params) is unchanged.

import { registerForm, bindMustFile, bindField } from "../engine.js";
import * as r from "../rules/index.js";

registerForm({
  formId: "form-1040",
  taxYear: 2025,
  jurisdiction: "federal",
  title: "U.S. Individual Income Tax Return",
});

bindMustFile("form-1040", r.lookupDecision, {
  decisionKey: "decisions.scope.must_file_federal",
});

// ─── Header — personal info + filing scope ───
// These derive from identity facts and the filing-status decision. They
// exist so the Filing Status panel knows whether the form's header is
// complete; PDF rendering still reads raw facts directly.

bindField(
  "form-1040",
  {
    fieldId: "form-1040.header.first_name",
    label: "First name",
    category: "personal_info",
    valueType: "text",
  },
  r.lookupFact,
  { factKey: "identity.name.first" },
);

bindField(
  "form-1040",
  {
    fieldId: "form-1040.header.last_name",
    label: "Last name",
    category: "personal_info",
    valueType: "text",
  },
  r.lookupFact,
  { factKey: "identity.name.last" },
);

bindField(
  "form-1040",
  {
    fieldId: "form-1040.header.ssn",
    label: "SSN",
    category: "personal_info",
    valueType: "text",
  },
  r.lookupFact,
  { factKey: "identity.ssn" },
);

bindField(
  "form-1040",
  {
    fieldId: "form-1040.header.address",
    label: "Home address",
    category: "personal_info",
    valueType: "text",
  },
  r.lookupFact,
  { factKey: "identity.address" },
);

bindField(
  "form-1040",
  {
    fieldId: "form-1040.header.filing_status",
    label: "Filing status",
    category: "filing_scope",
    valueType: "single_select",
  },
  r.lookupDecision,
  { decisionKey: "decisions.scope.filing_status" },
);

// ─── Wages from W-2s ───

// Line 1a — Total amount from Form(s) W-2, box 1
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.1a",
    label: "Total amount from Form(s) W-2, box 1",
    category: "income",
    valueType: "numeric",
  },
  r.sumFacts,
  { category: "wages", keyPrefix: "employer.", fieldPath: "box1" },
);

// Line 1z — Add lines 1a through 1h (only 1a populated for now).
// When 1b–1h land, add them as additional terms.
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.1z",
    label: "Add lines 1a through 1h",
    category: "income",
    valueType: "numeric",
  },
  r.fromFields,
  {
    terms: [
      { formId: "form-1040", fieldId: "form-1040.line.1a", sign: 1 },
    ],
    rationale: "Currently only line 1a is populated.",
  },
);

// ─── Dividends from 1099-DIVs ───

// Line 3a — Qualified dividends (1099-DIV box 1b)
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.3a",
    label: "Qualified dividends",
    category: "income",
    valueType: "numeric",
  },
  r.sumFacts,
  {
    category: "investment_income",
    keyPrefix: "account.",
    fieldPath: "box1b",
  },
);

// Line 3b — Ordinary dividends (1099-DIV box 1a)
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.3b",
    label: "Ordinary dividends",
    category: "income",
    valueType: "numeric",
  },
  r.sumFacts,
  {
    category: "investment_income",
    keyPrefix: "account.",
    fieldPath: "box1a",
  },
);

// ─── Capital gain/(loss) ───
// TODO(Phase F): once Schedule D is reintroduced, rebind to:
//   r.fromFields with terms = [{
//     formId: "schedule-d",
//     fieldId: "schedule-d.line.16",
//     sign: 1,
//     whenSourceNotRequired: 0,
//   }]
// For Phase A, Schedule D isn't registered so line 7 is just zero.
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.7",
    label: "Capital gain or (loss). Attach Schedule D if required",
    category: "income",
    valueType: "numeric",
  },
  r.constant,
  {
    value: 0,
    rationale: "Schedule D disabled in Phase A; restored in Phase F.",
  },
);

// Line 9 — Total income (1z + 3b + 7)
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.9",
    label: "Total income",
    category: "income",
    valueType: "numeric",
  },
  r.fromFields,
  {
    terms: [
      { formId: "form-1040", fieldId: "form-1040.line.1z", sign: 1 },
      { formId: "form-1040", fieldId: "form-1040.line.3b", sign: 1 },
      { formId: "form-1040", fieldId: "form-1040.line.7", sign: 1 },
    ],
    rationale: "Sum of lines 1z, 3b, 7 (only ones populated for this return).",
  },
);

// Line 10 — Adjustments to income (Schedule 1). Zero for MVP.
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.10",
    label: "Adjustments to income from Schedule 1",
    category: "deductions_credits",
    valueType: "numeric",
  },
  r.constant,
  { value: 0, rationale: "No Schedule 1 adjustments for this return." },
);

// Line 11 — AGI (9 − 10)
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.11",
    label: "Adjusted gross income (line 9 − line 10)",
    category: "income",
    valueType: "numeric",
  },
  r.fromFields,
  {
    terms: [
      { formId: "form-1040", fieldId: "form-1040.line.9", sign: 1 },
      { formId: "form-1040", fieldId: "form-1040.line.10", sign: -1 },
    ],
    rationale: "Line 9 minus line 10.",
  },
);

// ─── Standard deduction (line 12) ───
// 2025 federal standard deductions, keyed on filing status.
const STD_DEDUCTION_2025: Record<string, number> = {
  single: 15000,
  married_filing_jointly: 30000,
  married_filing_separately: 15000,
  head_of_household: 22500,
  qualifying_surviving_spouse: 30000,
};

bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.12",
    label: "Standard deduction",
    category: "deductions_credits",
    valueType: "numeric",
  },
  r.tableLookupByDecision,
  {
    decisionKey: "decisions.scope.filing_status",
    table: STD_DEDUCTION_2025,
  },
);

// Line 13 — QBI deduction. Zero for MVP.
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.13",
    label: "Qualified business income deduction",
    category: "deductions_credits",
    valueType: "numeric",
  },
  r.constant,
  { value: 0, rationale: "No QBI deduction for this return." },
);

// Line 14 — 12 + 13
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.14",
    label: "Add lines 12 and 13",
    category: "deductions_credits",
    valueType: "numeric",
  },
  r.fromFields,
  {
    terms: [
      { formId: "form-1040", fieldId: "form-1040.line.12", sign: 1 },
      { formId: "form-1040", fieldId: "form-1040.line.13", sign: 1 },
    ],
    rationale: "Standard deduction + QBI.",
  },
);

// Line 15 — Taxable income (11 − 14, not less than 0)
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.15",
    label: "Taxable income (line 11 − line 14, not less than 0)",
    category: "income",
    valueType: "numeric",
  },
  r.fromFields,
  {
    terms: [
      { formId: "form-1040", fieldId: "form-1040.line.11", sign: 1 },
      { formId: "form-1040", fieldId: "form-1040.line.14", sign: -1 },
    ],
    floor: 0,
    rationale: "AGI minus deductions, floored at zero.",
  },
);

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

bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.16",
    label: "Tax",
    category: "deductions_credits",
    valueType: "numeric",
  },
  r.bracketLookup,
  {
    decisionKey: "decisions.scope.filing_status",
    inputFieldId: "form-1040.line.15",
    brackets: ORDINARY_BRACKETS_2025,
  },
);

// Line 23 — Other taxes (Schedule 2). Zero for MVP.
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.23",
    label: "Other taxes from Schedule 2",
    category: "deductions_credits",
    valueType: "numeric",
  },
  r.constant,
  { value: 0, rationale: "No other taxes." },
);

// Line 24 — Total tax (16 + 23)
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.24",
    label: "Total tax (line 16 + line 23)",
    category: "deductions_credits",
    valueType: "numeric",
  },
  r.fromFields,
  {
    terms: [
      { formId: "form-1040", fieldId: "form-1040.line.16", sign: 1 },
      { formId: "form-1040", fieldId: "form-1040.line.23", sign: 1 },
    ],
    rationale: "Tax + other taxes.",
  },
);

// Line 25a — Federal income tax withheld from W-2 box 2
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.25a",
    label: "Federal income tax withheld from Form(s) W-2",
    category: "deductions_credits",
    valueType: "numeric",
  },
  r.sumFacts,
  { category: "wages", keyPrefix: "employer.", fieldPath: "box2" },
);

// Line 33 — Total payments (currently just 25a)
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.33",
    label: "Total payments",
    category: "deductions_credits",
    valueType: "numeric",
  },
  r.fromFields,
  {
    terms: [
      { formId: "form-1040", fieldId: "form-1040.line.25a", sign: 1 },
    ],
    rationale: "Currently only line 25a contributes.",
  },
);

// Line 34 — Amount overpaid (refund). max(0, 33 − 24).
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.34",
    label: "Amount overpaid (line 33 − line 24)",
    category: "deductions_credits",
    valueType: "numeric",
  },
  r.fromFields,
  {
    terms: [
      { formId: "form-1040", fieldId: "form-1040.line.33", sign: 1 },
      { formId: "form-1040", fieldId: "form-1040.line.24", sign: -1 },
    ],
    floor: 0,
    rationale: "Refund: payments minus tax, floored at zero.",
  },
);

// Line 37 — Amount you owe. max(0, 24 − 33).
bindField(
  "form-1040",
  {
    fieldId: "form-1040.line.37",
    label: "Amount you owe (line 24 − line 33)",
    category: "deductions_credits",
    valueType: "numeric",
  },
  r.fromFields,
  {
    terms: [
      { formId: "form-1040", fieldId: "form-1040.line.24", sign: 1 },
      { formId: "form-1040", fieldId: "form-1040.line.33", sign: -1 },
    ],
    floor: 0,
    rationale: "Balance due: tax minus payments, floored at zero.",
  },
);
