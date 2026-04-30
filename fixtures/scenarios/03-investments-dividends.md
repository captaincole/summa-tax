# Scenario 03 — Investments (Dividends + Two Sales)

**Thumbnail:** Single W-2 earner, renter in California, $100k income, holds one taxable brokerage account that throws off dividends *and* had two realized sales in 2025 — one long-term, one short-term. Adds a non-wage income source on top of the base case and exercises the LT-vs-ST split that's the motivating example for the Gold→Mart projection layer. Schedule B *not* required (dividends under $1,500); Schedule D + Form 8949 *required* (two reportable sales).

## Persona

- **Name:** Alejandro Reyes
- **Age:** 34, single, no dependents
- **Residence:** San Francisco, CA (renter, one state all year)
- **Employment:** W-2 only, single employer (Pacific Software, Inc.)
- **Filing status:** Single
- **Tax year:** 2025
- **Prior year:** Self-filed via TurboTax; took standard deduction
- **Tax literacy:** Moderate. Alejandro knows what a W-2 and a 1099 are; doesn't know the difference between qualified and ordinary dividends, doesn't know what Schedule B is. Will reliably upload W-2 and the consolidated 1099 his broker mailed him; will not preemptively classify income.

## Source documents provided

| Document | Path |
|---|---|
| W-2 from Pacific Software | `fixtures/docs/03-alejandro-w2.pdf` |
| Consolidated 1099 from Apex Securities (DIV section only) | `fixtures/docs/03-alejandro-1099.pdf` |

**Documents Alejandro doesn't know about and shouldn't be asked for:**

- **Form 1095-C** (employer health coverage). Exists; not load-bearing. MEC confirmed verbally.
- **No 1099-INT** — Alejandro's brokerage cash sweep paid no material interest in 2025; the 1099 he got has the INT section but it's all zero.
- **No 1098** (renter).
- **No 1098-E** (no student loans).
- **No Form 5498** (no IRA — only the brokerage and a checking account).

## W-2 ground truth (Pacific Software, Inc.)

| Box | Label | Value |
|---|---|---|
| a | Employee SSN | 234-56-7890 |
| b | Employer EIN | 47-8901234 |
| c | Employer name / address | Pacific Software, Inc. / 600 Townsend Street, San Francisco, CA 94103 |
| e | Employee name | Alejandro Reyes |
| f | Employee address | 123 Valencia Street, San Francisco, CA 94110 |
| 1  | Wages, tips, other comp | **100,000.00** |
| 2  | Federal income tax withheld | 14,500.00 |
| 3  | Social security wages | 100,000.00 |
| 4  | Social security tax withheld | 6,200.00 |
| 5  | Medicare wages | 100,000.00 |
| 6  | Medicare tax withheld | 1,450.00 |
| 13 | Retirement plan | ☐ unchecked |
| 14 | Other — CA SDI | 1,100.00  *(1.1% × $100,000)* |
| 15 | State | CA |
| 16 | State wages | 100,000.00 |
| 17 | State income tax withheld | 5,500.00 |

No box 12 entries — Alejandro did not contribute to a 401(k) in 2025. Boxes 3 and 5 equal box 1; no pre-tax exclusions.

## Consolidated 1099 ground truth (Apex Securities, Inc.)

**Payer:** Apex Securities, Inc., 1 Market Street, Suite 3000, San Francisco, CA 94105 (Federal ID: 13-2345678)
**Account number:** 4471-029-883
**Holdings:** Core position is Vanguard S&P 500 ETF (VOO, CUSIP 922908363), ~$30k market value at year-end. Plus two opportunistic single-stock positions opened and (partially) closed during the year — see 1099-B detail below.

The consolidated form has all five sub-form sections (DIV, INT, MISC, OID, B). **1099-DIV** and **1099-B** sections are populated; INT / MISC / OID render at $0 — that's how brokers issue consolidated forms even for accounts with limited activity.

### 1099-DIV box totals

| Box | Label | Value |
|---|---|---|
| 1a | Total ordinary dividends | **385.20** |
| 1b | Qualified dividends | **381.40** |
| 2a | Total capital gain distributions | 0.00 |
| 3  | Non-dividend distributions | 0.00 |
| 4  | Federal income tax withheld | 0.00 |
| 5  | Section 199A dividends | 0.00 |
| 7  | Foreign tax paid | 0.00 |
| 12 | Exempt-interest dividends | 0.00 |

All other DIV boxes 0.00.

### 1099-DIV detail (per-payment)

| Description | CUSIP | Pay date | Ordinary div | Qualified div |
|---|---|---|---|---|
| Vanguard S&P 500 ETF | 922908363 | 03/31/25 | 93.40 | 92.50 |
| Vanguard S&P 500 ETF | 922908363 | 06/30/25 | 94.20 | 93.20 |
| Vanguard S&P 500 ETF | 922908363 | 09/30/25 | 96.10 | 94.80 |
| Vanguard S&P 500 ETF | 922908363 | 12/22/25 | 101.50 | 100.90 |
| **Total** |  |  | **385.20** | **381.40** |

### 1099-B box totals

| Box | Label | Value |
|---|---|---|
| 1d | Proceeds (total) | **13,150.00** |
|    | — Covered Securities | 13,150.00 |
|    | — Noncovered Securities | 0.00 |
| 1e | Cost or Other Basis of Covered | **10,600.00** |
| 1f | Accrued Market Discount | 0.00 |
| 1g | Wash Sale Loss Disallowed | 0.00 |
| 4  | Federal Income Tax Withheld | 0.00 |

### 1099-B trade detail

**Long Term — Covered Securities** (Form 8949 Part II Box D)

| Description | CUSIP | Symbol | Qty | Acquired | Sold | Proceeds | Cost basis | Gain/(loss) |
|---|---|---|---:|---|---|---:|---:|---:|
| APPLE INC | 037833100 | AAPL | 50 | 06/15/23 | 09/15/25 | 11,500.00 | 9,250.00 | **2,250.00** |

**Short Term — Covered Securities** (Form 8949 Part I Box A)

| Description | CUSIP | Symbol | Qty | Acquired | Sold | Proceeds | Cost basis | Gain/(loss) |
|---|---|---|---:|---|---|---:|---:|---:|
| NVIDIA CORP | 67066G104 | NVDA | 10 | 02/10/25 | 11/20/25 | 1,650.00 | 1,350.00 | **300.00** |

**Realized totals:** $2,250 long-term + $300 short-term = **$2,550 net capital gain**.

### Other 1099 sections (all zero)

- 1099-INT: all boxes $0.00
- 1099-MISC: all boxes $0.00
- 1099-OID: all boxes $0.00

## Scoping questions Thom must ask

| Question | Expected answer | Effect |
|---|---|---|
| Filing status / dependents? | Single, no deps | Form 1040 in scope |
| Did you own a home in 2025? | No, renter | Schedule A likely out of scope — confirm after totaling |
| HSA at any point in 2025? | No | Form 8889 out of scope |
| Investments outside retirement? | Yes — one taxable brokerage at Apex | **1099-DIV ingest path active; Schedule B threshold check needed** |
| Did you sell any investments in 2025? | Yes — sold AAPL (held since 2023) and NVDA (bought + sold within 2025) | **Schedule D + Form 8949 in scope** |
| Self-employment / side income? | No | Schedule C/SE out of scope |
| Foreign accounts or income? | No | Forms 8938 / FBAR out of scope |
| Charitable gifts in 2025? | Yes, ~$300 cash | Record; informational only |
| Estimated tax payments made? | No | Skip |
| State residency all year? | Yes, CA only | Single-state return |
| Had health insurance all year? | Yes, via employer | Confirm MEC verbally; no 1095-C requested |

## Expected case-engine output

- **In scope:** Form 1040, **Schedule D**, **Form 8949** (Part I Box A + Part II Box D), CA Form 540 (state)
- **Out of scope (after scoping):**
  - Schedule A — itemizable ($5,500 state + $1,100 CA SDI + $300 charity = **$6,900**) loses to standard ($15,000)
  - Schedule B — total ordinary dividends $385.20 < $1,500 threshold → not required
  - Schedule C, Schedule E, Form 8889, Form 8938 — all closed via negative facts
- **AI decisions Nynaeve must ground:**
  - `decisions.schedule_b_required` — false, because $385.20 < $1,500. Cite IRS instructions for Schedule B Part I filing threshold.
  - `decisions.dividend_classification` — qualified vs. ordinary split is broker-reported (box 1b ≤ box 1a); no judgment call required.
  - `decisions.lt_st_classification` — broker-reported (date-acquired vs. date-sold). AAPL >1yr held = LT; NVDA <1yr held = ST. No judgment call required, but the decision is still recorded so the federal vs. CA projection layer can branch on it (federal differentiates LT/ST; CA does not).
- **Federal projection (preview):** LT gain $2,250 → 1040 line 7 / Schedule D line 15; ST gain $300 → Schedule D line 7. LT taxed at 15% LTCG rate at this income level; ST taxed at ordinary rate.
- **CA projection (preview):** Both gains treated as ordinary income — $2,550 added to CA AGI without an LT/ST split. This is the canonical book-to-tax difference example the architecture is designed to handle in the projection layer rather than in Gold.
- **Open asks after both docs processed:** confirm "any other taxable investment accounts?", confirm reinvested dividends are also reportable (yes — clarify if asked), confirm AAPL/NVDA are the only sales.

## Inventory

### Data sources available
| Source | Role | Auth | MVP? |
|---|---|---|---|
| User chat | Primary — scoping Qs, confirmations | None | ✓ |
| Uploaded PDF | Alejandro drops W-2 + consolidated 1099 | None | ✓ |
| Prior-year return (optional) | Context; last year also standard | User upload | later |
| Plaid MCP | Confirm payroll deposits, dividend deposits | OAuth | later |

### Input forms (what we collect)
- W-2 — Pacific Software, Inc.
- Consolidated 1099 — Apex Securities, Inc. (DIV + B sections populated; INT/MISC/OID zero)

### Output tax forms (what we file)
- Form 1040
- Schedule D (capital gains and losses)
- Form 8949 — Part I Box A (NVDA short-term, basis reported), Part II Box D (AAPL long-term, basis reported)
- CA Form 540 (state)

### Accounting artifacts (internal deliverables)
- Wage reconciliation (W-2 ↔ payroll/bank, if Plaid connected)
- Investment income reconciliation (1099-DIV + 1099-B ↔ broker statements, if Plaid connected)
- Schedule B threshold check (sub-$1,500 → not required) — AI decision, Nynaeve-grounded
- LT vs ST trade classification (broker-reported, surfaced as a decision so the projection layer has it)
- Health coverage confirmation — MEC all 12 months (verbal)
- Scoping closure memo — Schedule A / B / C / E / 8889 / 8938 all out of scope with citations
- Itemize-vs-standard decision (result: standard — $15,000 vs $6,900)
- Client-facing return summary
- CPA review packet

## Why this scenario matters

- **First non-W-2 income.** Exercises whether the layered architecture (Bronze → Silver → Gold → federal Mart) can absorb new income types without touching the wages path. Adding investments should mean: extend the Gold `PersonalPnL` and `PersonalBalanceSheet` shapes, add 1099-DIV + 1099-B ingest, add federal projections for line 3a/3b/7 + Schedule D + Form 8949 — nothing else.
- **LT vs ST projection.** Direct test of the architectural argument for keeping book-to-tax adjustments in the projection layer. AAPL (LT) and NVDA (ST) flow through Gold the same way, but the federal Mart splits them onto different Schedule D / Form 8949 boxes and applies different tax rates, while a CA Mart would treat both as ordinary income. Same Gold row, different projection.
- **Schedule B threshold decision.** First scenario that requires an AI decision tied to a numeric threshold. Tests Nynaeve's grounding pipeline against IRS Schedule B instructions.
- **Consolidated-form ingest.** Real brokerages don't issue separate 1099-DIV / 1099-INT / 1099-B forms — they issue a single consolidated statement with optional sections. Alejandro's DIV + B are populated; INT/MISC/OID render at $0 — proves the ingest tool can handle "section is present but empty."
- **Standard still wins.** Itemizable doesn't move much from Alex's case; Alejandro confirms the engine doesn't accidentally flip itemize when small new income sources appear.
