# Test scenarios — the MVP working set

Two canonical taxpayer situations we build against. Each scenario file specifies:

- Persona, filing status, tax year
- Every source document's ground truth (every W-2 box, etc.)
- Scoping questions and expected answers (including the negative ones)
- Expected case-engine output (in/out of scope, itemize vs standard)
- A four-part inventory: **data sources, input forms, output forms, accounting artifacts**

| # | Scenario | Shape |
|---|---|---|
| 01 | [Base case](./01-base-case.md) | Single CA renter, $85k W-2 with 401(k), takes standard deduction |
| 02 | [Itemize case](./02-itemize-case.md) | MFJ CA homeowners, $350k W-2 + 2 kids + mortgage + charity, itemizes |

Document PDFs live in `fixtures/docs/` (TBD — to be generated separately).

## Working backwards from the inventories

The union of the two scenarios' inventories defines the MVP workflow list. Three classes:

### 1. Integration workflows — input side

One per data source. Parameterized, idempotent, produces facts with `source_note` citations. Can be called multiple times per case.

| Workflow | Triggered by | Produces | Needed by MVP? |
|---|---|---|---|
| `ingestUploadedDocument` | User drops a PDF | Facts parsed from W-2 / 1098 / 1099-* / property tax / charity letter | **yes** |
| `importPriorYearReturn` | User uploads prior 1040 | Context facts, carryovers, last-year's decisions | later |
| `connectPlaidAndScan` | User consents to bank link | Corroborating cash-flow facts (payroll, mortgage pmt, charity debits) | later |
| `importW2ViaPayroll` | Payroll provider known + consent | W-2 facts direct from source | later |
| `fetchMortgage1098` | Mortgage servicer + consent | Interest, principal, points, escrow | later |
| `fetchPropertyTax` | County + APN | Property tax paid in year | later |
| `scanGmailForReceipts` | Gmail MCP authed | Charity acknowledgments, brokerage notices | later |

MVP reality: `ingestUploadedDocument` is the only integration worth building first, and even that starts as "user pastes structured JSON / we hand-parse a known-shape fixture PDF." Real OCR is a later service (per `CLAUDE.md`).

### 2. Tax form workflows — output side

One per form we might file. Declares requirements; runs when satisfied; writes the form output.

| Workflow | Requires (abbreviated) | Scenario coverage |
|---|---|---|
| `prepareForm1040` | identity, filing status, dependents, all income, adjustments, deductions | 01, 02 |
| `prepareScheduleA` | SALT, mortgage interest, charity, medical (if over threshold) | 02 |
| `prepareSchedule8812` | Qualifying child details, AGI for phase-out | 02 |
| `prepareStateReturn` | Resident state(s), state withholding, state-specific adjustments | 01 (CA), 02 (CA) |

### 3. Accounting artifact workflows — internal deliverables

One per professional-judgment work product. This is where a CPA earns their fee.

| Workflow | Requires | Output | Scenario coverage |
|---|---|---|---|
| `reconcileWages` | W-2 + (optional) payroll/bank | Wage reconciliation worksheet | 01, 02 |
| `decideItemizeVsStandard` | All Schedule A inputs, standard deduction table, filing status | Itemize decision memo | 01, 02 |
| `checkCTCQualification` | Per-dependent age/relationship/residency facts | Per-child eligibility record | 02 |
| `checkCTCPhaseOut` | AGI, filing status, qualifying child count | Phase-out result (full / reduced / none) | 02 |
| `buildSALTAnalysis` | State tax w/h, property tax, AGI | Cap + phase-out workup | 02 |
| `checkMortgageAcquisitionDebt` | 1098 principal, origination date | Full-deduct / pro-rate decision | 02 |
| `checkSaversCredit` | AGI, retirement contributions, filing status | Eligibility result | 01 |
| `buildDeductionWorkup` | Schedule A inputs with citations | Line-by-line workup doc | 02 |
| `closeScopingArtifact` | Negative-fact evidence for a form | Memo explaining *why* excluded | 01, 02 |
| `buildReturnSummary` | Completed return | Plain-English client summary | 01, 02 |
| `buildCPAReviewPacket` | Everything above | Bundle for CPA sign-off | 01, 02 |

## Thom's job in this picture

She doesn't compute taxes. She:

- **Orchestrates** — each turn, asks the case engine "what workflows are runnable / blocked / done?" and acts on it
- **Runs** runnable workflows autonomously when no user input is needed
- **Asks** the user when a workflow suspends for input, batching related asks where possible
- **Answers** factual questions straight from `tax_facts` without needing a workflow (e.g., "how much did Jordan make?" → read the fact, cite the W-2 box)
- **Scopes** — drives the negative-fact path that closes artifacts out

## Proposed MVP slice

The smallest set that takes **both** scenarios from "hello" to "ready for CPA review":

**Must build:**
- `src/tax/artifacts/` — form specs for 1040, Schedule A, Schedule 8812, CA Form 540, W-2 (source doc)
- `src/tax/engine.ts` — `computeCaseState(facts) → { inScope, outOfScope, pending, openAsks, runnableWorkflows }`
- `ingestUploadedDocument` — stubbed parser for W-2 and 1098 (JSON input for MVP; real OCR later)
- `decideItemizeVsStandard` — real logic (both scenarios gate on this)
- `checkCTCQualification` + `checkCTCPhaseOut` — scenario 02 needs these
- `closeScopingArtifact` — drives scoping-question closure
- Thom's instructions rewritten as the orchestrator described above

**Stub only:**
- `prepareForm1040`, `prepareScheduleA`, `prepareSchedule8812`, `prepareStateReturn` — validate requirements present; output is a JSON summary for now (actual form-filling is Stage 3)
- `buildReturnSummary`, `buildCPAReviewPacket` — placeholder markdown generators

**Skip for MVP:**
Plaid, payroll MCPs, mortgage servicer MCPs, county APIs, Gmail MCP, prior-year PDF import, real OCR. All additive once the skeleton runs both scenarios.
