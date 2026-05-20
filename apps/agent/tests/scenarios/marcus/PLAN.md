# Marcus Chen scenario — build plan

A handoff doc for the session that picks this up. Read this top-to-bottom
before touching anything. The existing Alejandro scenario at
`apps/agent/tests/scenarios/alejandro/` is the canonical pattern to mirror.

## Why this scenario exists

We have two scenarios today:
- **Alex** — single CA filer, one W-2, no investments. Tests the clean-W-2 path.
- **Alejandro** — adds a 1099-DIV + 1099-B trades (NVDA short-term, AAPL
  long-term). Tests QDCG worksheet, Schedule D, Form 8949.

**Marcus** is the next step up: a higher-income single CA filer whose return
exercises bracket-y behavior we don't cover today (NIIT, Additional Medicare
Tax) and introduces three new fact patterns:
1. **1099-INT** (HYSA interest) — no fact helper exists in the codebase yet
2. **HSA contribution** — Form 8889 territory
3. **Nondeductible trad IRA contribution** — a `record-ai-decision` moment
   (over phase-out + covered by employer plan → nondeductible)

It also forces an itemize-vs-standard decision via the SALT cap.

## Phase A — produce Marcus's intake package (do this first)

The work happens in two phases. **Phase A is everything we're focused on
right now.** No codebase changes yet — the goal is to assemble the package
a CPA needs to prepare Marcus's return manually, then receive their work
product back as our ground truth.

**Deliverables for Phase A:**

1. **A written scenario brief** (one-pager) describing Marcus, like an
   intake organizer:
   - Identity, address, filing status, age, occupation, dependents (none)
   - Life events for 2025 (none — clean year)
   - Income sources at a glance
   - Notable items: HYSA, HSA, nondeductible trad IRA, brokerage activity
   - Anything we want the CPA to flag in their work product (e.g. "please
     note the IRA contribution; we expect it to be nondeductible")

2. **Source documents (PDFs)** — what Marcus would actually receive:
   - **W-2** from his tech employer
   - **1099-INT** from his HYSA *(user will upload a real one from their
     own brokerage to copy the box layout)*
   - **Consolidated 1099** (1099-DIV + 1099-B) from his brokerage — same
     shape as Alejandro's `02-alejandro-1099.pdf`
   - **HSA contribution statement** — only needed if HSA is direct
     (post-tax); if payroll, W-2 box 12 code W covers it
   - **IRA contribution confirmation** — a letter or statement from the
     IRA custodian; the actual 5498 doesn't arrive until May so a CPA
     would normally work from a contribution confirmation

3. **Cover note to the CPA** — a short brief stating what we want
   prepared (federal 1040 + CA 540), any notes on residency / coverage,
   and the IRA nondeductibility heads-up.

**Out of scope in Phase A:**
- Any code changes (`facts.ts`, fact helpers, form bindings, etc.)
- Any expected-output / golden assertions
- Anything inside `apps/agent/src/`

**Open question for Phase A:** How were Alejandro's source PDFs
(`01-alejandro-w2.pdf`, `02-alejandro-1099.pdf`) generated? If there's a
templating tool or generator script in the repo, reuse it. If they were
hand-built in a PDF tool, we'll do the same for Marcus. Check
`apps/agent/scripts/` and `apps/agent/fixtures/` before starting.

## Phase B — codebase integration (later, depends on CPA output)

Once the CPA returns Marcus's prepared 2025 federal + CA returns, those
PDFs become the goldens. Then we do the codebase work in two PRs:

### PR 1 — 1099-INT plumbing

Adds the typed fact builder + binding so a scenario can express "Marcus
received $700 in HYSA interest." No scenario fixture in this PR — just
the infrastructure and a unit test.

**Wait for the user's uploaded 1099-INT sample before locking the
`InterestFactValue` shape.** We want the type to mirror what real-world
1099-INTs actually look like, not a guess.

**Files to add/touch (mirror the Dividend pattern):**
- `apps/agent/src/mastra/facts/interest.ts` — `InterestFactValue` type +
  `makeInterestFactKey(payerSlug)`. Box 1 (interest income) required;
  box 3 (US savings bond/Treasury), box 4 (federal income tax withheld),
  box 8 (tax-exempt interest), box 15–17 (state info) optional.
- `apps/agent/src/mastra/facts/index.ts` — re-export the new types/helpers.
- Wherever 1040 line 2b lives — bind 1099-INT box 1 sum onto **1040 line
  2b (taxable interest)**. Confirm category = `income`, valueType =
  `numeric` per the FormField contract in `CLAUDE.md`. Box 8 sums onto
  1040 line 2a; box 4 sums onto 1040 line 25b.
- **Schedule B Part I** — required when taxable interest > $1,500. Likely
  doesn't exist as a form module yet; check `apps/agent/forms/federal/`.
  If absent, building Schedule B is acceptable scope creep — we need it
  for Marcus regardless. Surface in the PR description.
- **Unit test** — drop a fact, evaluate the 1040, assert line 2b sums.

### PR 2 — Marcus Chen scenario fixture

Builds on PR 1. Mirror Alejandro's layout exactly:
`apps/agent/tests/scenarios/marcus/{facts.ts, decisions.ts, expected.ts,
expected-540.ts, expected-schedule-ca.ts, expected-schedule-d.ts,
expected-8949.ts, expected-schedule-b.ts, index.ts, docs/*}`. The CPA's
prepared returns go in `docs/` as `Marcus-*-Golden.pdf`. The `expected-*`
modules encode whatever's on those goldens.

## Marcus's profile

**Identity (confirmed):**
- Name: Marcus Chen
- Address: San Francisco, CA (same jurisdiction as Alejandro — reuses CA
  540 and Schedule CA binding work)
- Single, no dependents, full-year CA resident
- Tax year 2025

**W-2 (~$220k tech employer):**
- Box 1 wages: ~$220,000
- Box 12 code D: $23,500 (401(k) — 2025 elective deferral max). Makes him
  "covered by employer retirement plan" for IRA deduction purposes.
- Box 12 code W: TBD — see HSA section below
- Standard CA state withholding, CA SDI in box 14
- Pick a plausible SF tech employer name (not Pacific Software — Alejandro's)

**1099-INT (HYSA):**
- Principal ~$20k, ~3.5% APY → ~$700 interest
- Plausible online bank (Ally, Wealthfront Cash, Marcus by Goldman Sachs).
  *Avoid Marcus by Goldman if name collision with the taxpayer is awkward.*

**Brokerage (~$100k account):**
- 1099-DIV: ~$3,000 ordinary dividends, ~$2,000 of which qualified
- 1099-B with 4 trades, net winner ~$7.5k:
  - **ST**: one ~$4k gain, one ~$1.5k loss → net +$2.5k ST
  - **LT**: one ~$8k gain, one ~$3k loss → net +$5k LT
  - Liquid tickers different from Alejandro's NVDA/AAPL (GOOGL, MSFT, TSLA,
    AMZN, JPM, etc. — pick four)
- Different broker from Apex Securities — Schwab or Fidelity flavor

**HSA contribution ($4,150 — 2025 self-only HDHP limit):**
- *Open decision*: payroll (W-2 box 12 code W, already pre-tax) vs direct
  (post-tax, deducts on Schedule 1 line 13 via Form 8889). Different
  intake flows. Default: **payroll**, the more common path, exercises the
  W-2 box 12 code W binding (which may not exist yet — verify in Phase B).

**Nondeductible trad IRA ($7,000 — 2025 limit):**
- Marcus contributed the full $7k to a traditional IRA
- MAGI ~$220k > the 2025 deduction phase-out ceiling for covered filers
- Because he's also covered by an employer 401(k), the deduction is fully
  disallowed → **nondeductible contribution**. Form 8606 territory, but:
- **Form 8606 binding is out of scope.** We record the fact + AI decision;
  form binding stays TODO. The scenario tests the *decision*, not the form.

**SALT itemize-vs-standard:**
- CA state tax alone on $220k wages ≈ $18k → SALT capped at $10k
- Without mortgage interest, $10k SALT vs $15k standard deduction (2025
  single) → **standard wins**. The decision *is* the test.
- *Don't* add mortgage interest just to make itemize win — leave that for
  a future scenario.

## Expected AI decisions Thom should record

Thom should call `record-ai-decision` (fires Nynaeve synchronously) for:

1. **`decisions.ira_deduction`** — "nondeductible trad IRA"
   - Supporting facts: trad IRA contribution amount, W-2 box 12 code D
     (proves employer-plan coverage), W-2 box 1 (proves MAGI > phase-out)
   - Rationale: covered + MAGI > phase-out → no deduction
   - Confidence: high; groundable in IRS Pub 590-A
2. **`decisions.itemize_vs_standard`** — "standard deduction"
   - Supporting facts: CA state tax (derived), SALT cap rule, standard
     deduction amount for single 2025
   - Rationale: SALT cap + no mortgage / no large charitable → standard
     beats itemized
   - Confidence: high
3. **`decisions.niit_applies`** (if engine derives) — "NIIT applies"
   - MAGI > $200k single → 3.8% on lesser of NII or MAGI excess
   - Form 8960 territory; check whether the engine already handles this

Run `npm run refdocs:status` to confirm IRS Pub 590-A is in the corpus
before expecting Nynaeve to ground decision #1.

## Decisions still open

1. **HSA: payroll or direct?** Default to payroll unless there's reason to
   exercise the Schedule 1 deduction path.
2. **HYSA bank name** — Ally vs Wealthfront vs Marcus by Goldman (consider
   name collision).
3. **Trade tickers + exact dollar amounts** — pick concrete values when
   writing the fixture.
4. **Brokerage name** — Schwab vs Fidelity vs other.
5. **Tech employer name** — anything except Pacific Software.
6. **How Alejandro's source PDFs were generated** — answer this in Phase A
   before producing Marcus's.

## Reference files (read before coding)

- `apps/agent/tests/scenarios/alejandro/docs/*.pdf` — both source docs
  (01-, 02-) and goldens. Phase A produces the analogs of the source docs;
  Phase B receives the analogs of the goldens from the CPA.
- `apps/agent/tests/scenarios/alejandro/facts.ts` — canonical fact-builder
  usage (W-2, dividend, trade)
- `apps/agent/tests/scenarios/alejandro/expected.ts` — expected-1040 shape
- `apps/agent/tests/scenarios/alejandro/decisions.ts` — recorded-decision
  fixture format
- `apps/agent/src/mastra/facts/index.ts` — fact-builder re-exports
- `CLAUDE.md` — especially "Form engine — the FormField model" (category
  + valueType are required on every field) and "Facts vs. AI decisions"

## Things explicitly NOT in scope

- Form 8606 binding (nondeductible IRA basis tracking) — record decision,
  skip the form
- Form 8959 (Additional Medicare Tax) — derive if engine already does;
  no new binding
- Form 8960 (NIIT) — same as 8959
- Mortgage interest, charitable giving — leave for a future scenario
- Backdoor Roth — explicitly excluded per planning discussion
- Excess Roth contribution scenario — explicitly excluded per planning
  discussion
