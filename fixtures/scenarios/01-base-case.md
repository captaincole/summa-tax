# Scenario 01 — Base Case

**Thumbnail:** Single W-2 earner, renter in California, moderate income, 401(k) participant. Probably takes the standard deduction but doesn't know. Exercises the negative-facts path: Thom must ask the scoping questions even though most answers are "no."

## Persona

- **Name:** Alex Morales
- **Age:** 29, single, no dependents
- **Residence:** Oakland, CA (renter, one state all year)
- **Employment:** W-2 only, single employer
- **Filing status:** Single
- **Tax year:** 2025
- **Prior year:** Self-filed via TurboTax; took standard deduction
- **Tax literacy:** Low. Alex does not know what most tax forms are and doesn't know which ones he's received. He will not proactively mention documents by name. He will reliably upload what Thom explicitly asks him for (W-2), and will answer yes/no scoping questions honestly. Asking him to "go look for Form 1095-C" would waste his time; asking "did you have health insurance all year?" gets the same fact faster.

## Source documents provided

| Document | Path |
|---|---|
| W-2 from Brightside Logistics | `fixtures/docs/01-alex-w2.pdf` |

**Documents Alex doesn't know about and shouldn't be asked for** (the product principle: asking for a form is costly user labor — only ask when the form is load-bearing):

- **Form 1095-C** (employer health coverage). Exists — Brightside issued one — but not required to file and not needed to compute the return. Fact ("had MEC all 12 months") is captured verbally. Asking Alex to go find this would be wasted friction.
- **No 1099-INT** (Alex banks at a regular checking account, no HYSA — no interest to report).
- **No 1098** (renter).
- **No 1098-E** (no student loans).
- **No Form 5498** (no IRA — only the employer 401(k), already evidenced by W-2 box 12 code D).
- No brokerage statement, no HSA, no K-1, no charitable acknowledgments.

**Prior-year return:** Alex filed last year himself via TurboTax but cannot locate the PDF. Thom must handle this gracefully — fall back to conversational discovery (confirm filing status, dependents, and state haven't changed; confirm no carryovers like capital loss or charitable carryforward) rather than blocking on the missing doc.

## W-2 ground truth (Brightside Logistics)

| Box | Label | Value |
|---|---|---|
| a | Employee SSN | 123-45-6789 |
| b | Employer EIN | 36-1234567 |
| c | Employer name / address | Brightside Logistics, Inc. / 1800 Embarcadero, Oakland, CA 94606 |
| e | Employee name | Alex Morales |
| f | Employee address | 2245 Lakeshore Ave Apt 3, Oakland, CA 94606 |
| 1  | Wages, tips, other comp | **79,000.00** |
| 2  | Federal income tax withheld | 9,420.00 |
| 3  | Social security wages | 85,000.00 |
| 4  | Social security tax withheld | 5,270.00 |
| 5  | Medicare wages | 85,000.00 |
| 6  | Medicare tax withheld | 1,232.50 |
| 12 | Code D — 401(k) elective deferral | **6,000.00** |
| 13 | Retirement plan | ☒ checked |
| 14 | Other — CA SDI | 935.00  *(1.1% × $85,000, no 2025 cap)* |
| 15 | State | CA |
| 16 | State wages | 79,000.00 |
| 17 | State income tax withheld | 3,100.00 |

Gross pay reconciliation: $85,000 gross − $6,000 pre-tax 401(k) = $79,000 in box 1. Boxes 3 and 5 reflect gross ($85k) since 401(k) deferrals are not exempt from FICA.

## Scoping questions Thom must ask

| Question | Expected answer | Effect |
|---|---|---|
| Filing status / dependents? | Single, no deps | Form 1040 in scope |
| Did you own a home in 2025? (mortgage/prop tax) | No, renter | Schedule A likely out of scope — **confirm after totaling** |
| HSA at any point in 2025? | No | Form 8889 out of scope |
| Investments outside retirement? | No (just the 401(k)) | Schedule B/D out of scope |
| Self-employment / side income? | No | Schedule C/SE out of scope |
| Foreign accounts or income? | No | Forms 8938 / FBAR out of scope |
| Charitable gifts in 2025? | Yes, ~$400 cash total | Record; note it won't flip itemize — informational only |
| Estimated tax payments made? | No | Skip |
| State residency all year? | Yes, CA only | Single-state return |
| Had health insurance all year? | Yes, via employer | Confirm MEC verbally; no 1095-C requested; no marketplace reconciliation |
| Do you have last year's return? | No, can't find it | Fall back to conversational discovery (no carryovers, no major changes) |

## Expected case-engine output

- **In scope:** Form 1040, CA Form 540 (state)
- **Out of scope (after scoping):** Schedule A, Schedule B, Schedule C, Schedule D, Form 8889, Form 8938, Form 2441, Schedule E
- **Standard vs itemized:**
  - Itemizable: $3,100 state income tax + $935 CA SDI + $400 charity = **$4,435**
  - 2025 single standard deduction: **$15,000**
  - **→ Standard wins by ~$10.6k. Itemize out of scope.**
- **Open asks after W-2 processed:** none material. Confirm "no other income sources" and proceed to reconciliation stage.

## Inventory (working-backwards MVP input)

### Data sources available
| Source | Role | Auth | MVP? |
|---|---|---|---|
| User chat | Primary — scoping Qs, confirmations | None | ✓ |
| Uploaded PDF | Alex drops W-2 into conversation | None | ✓ |
| Prior-year return (optional) | Context; last year also standard | User upload | later |
| Plaid MCP | Confirm payroll deposits, confirm *no* mortgage/brokerage activity | OAuth | later |
| Payroll provider MCP | Direct W-2 pull from Brightside's system | OAuth | later |
| Gmail MCP | Charity acknowledgments (low value here) | OAuth | later |

### Input forms (what we need to collect)
- W-2 — Brightside Logistics

Intentionally **not** collected: 1095-C (not load-bearing — health coverage confirmed verbally), 1099-INT (none exists — no HYSA), 1098-E (no student loans), Form 5498 (no IRA). See "Documents Alex doesn't know about..." above for the product rationale.

### Output tax forms (what we end up filing)
- Form 1040
- CA Form 540 (state)

### Accounting artifacts (internal deliverables)
- Wage reconciliation (W-2 ↔ payroll/bank, if Plaid connected)
- Health coverage confirmation — MEC all 12 months (verbal; no 1095-C requested; no Form 8962 needed)
- Scoping closure memo — Schedule A / B / C / D, Forms 8889 / 2441 / 8938 all out of scope with negative-fact citations
- Prior-year comparison — gracefully skipped (no 2024 return available; no carryovers confirmed conversationally)
- Itemize-vs-standard decision (result: standard — $15,000 vs $4,435)
- Saver's credit eligibility check (phases out fully at Alex's income — negative result recorded)
- Client-facing return summary
- CPA review packet

## Why this scenario matters

- **Exercises the "most people take standard" path.** If Thom tries to collect a 1098 or charity receipts here, something's wrong — scoping closed Schedule A out.
- **Validates negative-fact recording.** Out-of-scope determinations require explicit "no" answers stored as facts, not implicit absence.
- **Simplest possible case engine run.** One source doc, one state, one employer, one credit evaluated (saver's credit) and closed as ineligible.
