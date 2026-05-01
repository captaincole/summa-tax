# Scenario 02 — Itemize Case

**Thumbnail:** MFJ California homeowners, one earner ($350k W-2 with 401(k)), 2 kids, mortgage under the $750k cap, modest cash charity. Itemizing wins clearly. Exercises Schedule A, SALT cap interaction, CTC, and doc-gathering beyond just the W-2.

## Persona

- **Names:** Jordan Park (earner) & Priya Park (SAH parent, no 2025 earned income)
- **Ages:** Jordan 38, Priya 36
- **Dependents:** Maya (age 7), Arjun (age 4) — both qualifying children
- **Residence:** Palo Alto, CA (one state all year; homeowners since 2022)
- **Filing status:** Married filing jointly
- **Tax year:** 2025
- **Prior year:** CPA-prepared; itemized

## Source documents provided

| Document | Path |
|---|---|
| W-2 (Jordan, Helios Semiconductors) | `fixtures/docs/02-jordan-w2.pdf` (TBD) |
| Form 1098 (Rocket Mortgage) | `fixtures/docs/02-parks-1098.pdf` (TBD) |
| Santa Clara County property tax receipt | `fixtures/docs/02-parks-property-tax.pdf` (TBD) |
| Charity acknowledgment letters (ACLU, Second Harvest) | `fixtures/docs/02-parks-charity-*.pdf` (TBD) |

No 1099-INT (interest under Schedule B threshold), no brokerage 1099-B, no HSA docs, no K-1, no foreign accounts.

## W-2 ground truth (Jordan — Helios Semiconductors)

| Box | Label | Value |
|---|---|---|
| a | Employee SSN | 234-56-7890 |
| b | Employer EIN | 94-3217654 |
| c | Employer name / address | Helios Semiconductors, Inc. / 1600 Amphitheatre Pkwy, Mountain View, CA 94043 |
| e | Employee name | Jordan Park |
| f | Employee address | 847 Addison Ave, Palo Alto, CA 94301 |
| 1  | Wages, tips, other comp | **326,500.00** |
| 2  | Federal income tax withheld | 65,300.00 |
| 3  | Social security wages | 168,600.00  *(2025 SS wage base cap)* |
| 4  | Social security tax withheld | 10,453.20 |
| 5  | Medicare wages | 350,000.00 |
| 6  | Medicare tax withheld | 6,425.00  *(1.45% × $350k + 0.9% addl on wages > $200k)* |
| 12 | Code D — 401(k) elective deferral | **23,500.00**  *(2025 under-50 limit)* |
| 13 | Retirement plan | ☒ checked |
| 14 | Other — CA SDI | 3,850.00  *(1.1% × $350k, no 2025 cap)* |
| 15 | State | CA |
| 16 | State wages | 326,500.00 |
| 17 | State income tax withheld | 29,000.00 |

Gross pay reconciliation: $350,000 gross − $23,500 pre-tax 401(k) = $326,500 in box 1. Boxes 3 and 5 reflect gross before 401(k).

## Other ground-truth facts

- **Mortgage (Form 1098, Rocket Mortgage):**
  - Loan origination: 2022-08-14
  - Outstanding principal 2025-01-01: $640,000 (below the $750k post-TCJA acquisition-debt cap — no pro-ration needed)
  - Interest paid 2025: **$37,200**
  - Points paid 2025: $0
- **Property tax (Santa Clara County, Park residence):** $14,100 paid during calendar year 2025
- **Charitable gifts (cash, fully documented):**
  - ACLU Foundation: $5,000 (single check, acknowledgment letter)
  - Second Harvest of Silicon Valley: $3,000 (single check, acknowledgment letter)
- **Interest income:** ~$320 total across two Ally savings accounts (under Schedule B $1,500 threshold; still reported on 1040 line 2b)
- **No childcare expenses:** Priya is SAH; no Form 2441

## Scoping questions Thom must ask

| Question | Expected answer | Effect |
|---|---|---|
| Filing status / dependents? | MFJ, 2 qualifying children | Form 1040 + CTC path |
| Did you own a home in 2025? | Yes, full year | Collect 1098 + property tax → Schedule A candidate |
| Charitable gifts in 2025? | Yes, $8k cash | Collect acknowledgment letters → Schedule A |
| HSA at any point in 2025? | No | Form 8889 out of scope |
| Investments outside retirement? | No | Schedule B/D out of scope |
| Self-employment / side income? | No (Priya SAH, no 1099) | Schedule C/SE out of scope |
| Foreign accounts / income? | No | Forms 8938 / FBAR out of scope |
| Paid childcare in 2025? | No (Priya at home) | Form 2441 out of scope |
| Estimated tax payments? | No (W-2 withholding only) | Skip |
| State residency all year? | Yes, CA only | Single-state return (Form 540) |

## Itemize vs standard math

| Category | Raw | Deductible |
|---|---|---|
| State income tax withheld | $29,000 | — |
| CA SDI (box 14) | $3,850 | — |
| Property tax | $14,100 | — |
| **SALT subtotal** | **$46,950** | **$40,000** *(2025 OBBBA cap, under $500k MAGI phase-out)* |
| Mortgage interest (1098) | $37,200 | $37,200 *(principal under $750k cap — fully deductible)* |
| Charity — cash to public charities | $8,000 | $8,000 *(well under 60% AGI limit)* |
| **Itemized total** | — | **$85,200** |
| 2025 MFJ standard deduction | — | $30,000 |

**→ Itemize wins by ~$55k. Schedule A in scope.**

## Expected case-engine output

- **In scope:** Form 1040, Schedule A, Schedule 8812 (CTC), CA Form 540
- **Out of scope (after scoping):** Schedule B, Schedule C, Schedule D, Schedule E, Form 8889, Form 8938, Form 2441
- **Child Tax Credit:** 2 qualifying children × $2,000 = $4,000. MFJ phaseout begins at $400k MAGI; Park AGI is approximately $326,500 + $320 interest = $326,820 — **well under phaseout**, full CTC available.
- **Open asks after all docs processed:** confirm no estimated tax payments, confirm no additional income sources, advance to reconciliation stage.

## Inventory (working-backwards MVP input)

### Data sources available
| Source | Role | Auth | MVP? |
|---|---|---|---|
| User chat | Primary — scoping Qs, confirmations | None | ✓ |
| Uploaded PDFs | W-2, 1098, property tax receipt, charity letters | None | ✓ |
| Plaid MCP | Confirm mortgage payments, property tax debits, charitable transfers, payroll deposits | OAuth | later |
| Payroll MCP (Helios) | Jordan's W-2 direct pull | OAuth | later |
| Mortgage servicer MCP (Rocket) | 1098 direct pull | OAuth | later |
| County assessor API (Santa Clara) | Property tax record by APN | Public / none | later |
| Gmail MCP | Charity acknowledgment letters, brokerage notices | OAuth | later |
| Prior-year return | CPA-prepared 2024 return PDF — provides CTC history, carryovers | User upload | later |

### Input forms (what we need to collect)
- W-2 — Jordan, Helios Semiconductors
- Form 1098 — Rocket Mortgage
- Property tax statement — Santa Clara County
- Charity acknowledgment letters — ACLU, Second Harvest

### Output tax forms (what we end up filing)
- Form 1040
- Schedule A (itemized deductions)
- Schedule 8812 (Credits for Qualifying Children)
- CA Form 540 (state)

### Accounting artifacts (internal deliverables)
- Wage reconciliation (Jordan's W-2 ↔ payroll/bank)
- Schedule A deduction workup (SALT detail, mortgage interest, charity — every line cited to source doc)
- SALT cap analysis — $46,950 raw → $40,000 post-OBBBA cap, no phase-out at AGI ~$327k
- Mortgage acquisition-debt check — principal $640k < $750k cap → no pro-ration
- Itemize-vs-standard decision memo — $85,200 itemized vs $30,000 standard → clear itemize
- CTC qualification check — both children meet age/relationship/residency/SSN tests
- CTC phase-out check — AGI ~$327k < $400k MFJ threshold → full $4,000 credit
- Scoping closure memo — Schedules B/C/D/E, Forms 8889/2441/8938 out of scope with negative-fact citations
- Client-facing return summary
- CPA review packet

## Why this scenario matters

- **Exercises the itemize path end-to-end.** If the engine recommends standard here, it's broken.
- **Exercises SALT cap logic** — raw SALT $46,950 has to be clamped to $40,000 for 2025 (OBBBA cap, no phase-out at this income).
- **Exercises multi-document gathering.** W-2 alone is insufficient; Thom must ask for 1098, property tax receipt, and charity acknowledgments. Good place to test batched asks vs sequential nagging.
- **Validates CTC availability check against phaseout.** A higher-income variant of this case would flip CTC partially out — useful future test.
- **Mortgage principal deliberately under $750k cap** to keep the MVP free of pro-ration math. A future scenario should push principal over $750k to exercise that path.
