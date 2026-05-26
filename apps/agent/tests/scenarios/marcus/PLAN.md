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

## Phase A — produce Marcus's intake package — DONE (2026-05-20)

The package the CPA receives is in `docs/`:

- `00-marcus-brief.md` — one-pager intake organizer (identity, income
  sources, HSA / IRA / NIIT flags)
- `00-marcus-cpa-cover.md` — cover note to the CPA (what to prepare,
  heads-up items, what's NOT needed)
- `01-marcus-w2.pdf` — Helix Software, Inc. W-2 (Copy B)
- `02-marcus-1099-wealthfront.pdf` — Wealthfront-style 6-page
  consolidated 1099 (only 1099-INT box 1 = $700 populated; all other
  sections $0, mirrors what a HYSA-only Wealthfront Cash account would
  receive)
- `03-marcus-1099-schwab.pdf` — Schwab-style 5-page consolidated 1099
  (1099-DIV $3,000 ord / $2,000 qual + 1099-B with 4 trades netting
  $7,500). Mirrors Alejandro's Apex Securities format.

### How the source PDFs were generated

Alejandro's source PDFs (`01-alejandro-w2.pdf`, `02-alejandro-1099.pdf`)
were hand-built — no generator script in the repo. For Marcus we wrote
one: `tests/scenarios/marcus/generate-docs.ts`. It uses `pdf-lib`
(already a project dep, used by `fillFromCatalog`) to draw each form
programmatically.

Run with:

```
cd apps/agent
npx tsx tests/scenarios/marcus/generate-docs.ts
```

Renders all three PDFs into `docs/` in ~1s. Idempotent — safe to
re-run.

### Process to update Marcus's source data

All scenario numbers are constants at the top of `generate-docs.ts`:
`MARCUS`, `HELIX`, `W2`, `WEALTHFRONT`, `SCHWAB`. Edit them and re-run
to regenerate the PDFs. Keep `00-marcus-brief.md` and
`00-marcus-cpa-cover.md` in sync by hand when you change material
facts.

The drawing helpers (`drawText`, `drawTextRight`, `drawLabeledBox`,
`drawColumn`, `drawSectionTitle`, `drawWrapped`) live in the same file.
Adding a new section to a 1099 is mostly choosing column x-positions
and calling `drawColumn` with `LineRow[]`.

**Watch-outs from building this:**
- pdf-lib's `drawText` takes y as the text *baseline* in bottom-up
  coords. Our `ty()` helper assumes y is the TOP of the em-box and
  baseline = y + fontSize. Pick value y so the line-box bottom sits
  ~4pt above the box bottom (e.g. `y = boxTop + h - 4 - fontSize`).
- Adjacent right-aligned columns must be spaced at least by the right
  column's **widest value** width. For size-8-bold totals like
  `$57,500.00` (~45pt) and `$(3,000.00)` (~48pt) that means 50pt+ gaps.
  Headers are usually narrower; values are the binding constraint.
- Long italic blurbs at narrow column widths need `drawWrapped` (greedy
  word-wrap). Single-line `drawText` calls will bleed across columns.

## Phase B — codebase integration

CPA goldens received 2026-05-26. PDFs live in `docs/Marcus-*-Golden.pdf`.

### Goldens received vs. existing form support

| Golden | Form | Form module today | Catalog needed |
|---|---|---|---|
| `Marcus-1040-Golden.pdf` | Form 1040 | ✅ supported | — |
| `Marcus-ScheduleD-Golden.pdf` | Schedule D | ✅ supported | — |
| `Marcus-8949-Golden.pdf` | Form 8949 | ✅ supported | — |
| `Marcus-540-Golden.pdf` | CA 540 | ✅ supported | — |
| `Marcus-ScheduleCA-Golden.pdf` | CA Schedule CA | ✅ supported | — |
| `Marcus-ScheduleA-Golden.pdf` | Schedule A | ❌ new | yes |
| `Marcus-ScheduleB-Golden.pdf` | Schedule B | ❌ new | yes |
| `Marcus-Schedule2-Golden.pdf` | Schedule 2 | ❌ new | yes |
| `Marcus-8889-Golden.pdf` | Form 8889 | ❌ new | yes |
| `Marcus-8959-Golden.pdf` | Form 8959 | ❌ new | yes |
| `Marcus-8960-Golden.pdf` | Form 8960 | ❌ new | yes |

No Form 8606 — matches the "out of scope" call below.

### Sequence — three steps per new form, two PRs

For every new form we follow the same three-step sequence. Bindings are
the most expensive step and are sequenced last so the cheap catalog +
fill-test work for all six new forms can land together first.

**Step 1 — Catalog build.** Run the blank PDF through `npm run forms:ingest`
(wraps the ingestFormWorkflow). Inputs: `blank.pdf`, an `instructions.pdf` +
`instructions.meta.json` sidecar, a stable `--form-id` (e.g. `schedule-a`,
`form-8889`), and `--tax-year=2025`. Output: `catalog.json` co-located with
the blank PDF under `apps/agent/forms/<jurisdiction>/<short>/`. Then
`npm run forms:promote` copies the catalog into
`src/mastra/public/forms/...` so the runtime registry picks it up.

**Step 2 — Catalog-fill golden.** Add a `FORMS` entry in
`src/mastra/engine/registry.ts` (catalog import + spec entry) but no
bindings yet. Then run
`npm run test:catalog-fill -- --form-id=<id> --update` to bootstrap the
synthetic-fill golden + a debug PDF at `/tmp/smoke-<formId>.pdf`. Eyeball
the PDF — every widget filled, no overflow, no missed widget. Commit the
golden. From then on, `runAll.ts` automatically regression-checks the
form because it iterates over `FORMS`.

**Step 3 — Bindings.** Wire `src/mastra/engine/<jurisdiction>/<short>/bindings.ts`
so the form's FormFields derive from facts / upstream forms. This is the
expensive step (per-field semantics, cross-form wiring) and is
**deferred to a future session** — see PR 2 below.

### PR 1 — Catalogs + fill-test goldens for six new forms (in flight)

No bindings, no fact-builder changes, no Marcus fixture. Just produce the
six new `catalog.json` + `catalog-fill-golden.json` pairs and register
the forms in `engine/registry.ts` so `runAll.ts` checks them.

Forms in order of acquisition difficulty:
1. **Schedule A** — straightforward IRS form, well-known layout
2. **Schedule B** — straightforward IRS form
3. **Schedule 2** — straightforward IRS form
4. **Form 8889** — HSA, single-page
5. **Form 8959** — Additional Medicare Tax
6. **Form 8960** — NIIT

Each form needs `blank.pdf` + `instructions.pdf` + `instructions.meta.json`
in `apps/agent/forms/federal/<short>/` before ingest can run. The IRS
direct URLs are listed in each form's instructions.meta.json once
created — pattern: `https://www.irs.gov/pub/irs-pdf/f<short>.pdf` for the
form, `https://www.irs.gov/pub/irs-pdf/i<short>.pdf` for instructions.

**Exception — Schedule 2 has no standalone instructions PDF.** The IRS
publishes Schedule 2 instructions only as part of the main 1040
instructions booklet (`i1040gi.pdf`, already in the corpus as
`irs-1040-inst-2025`). `forms/federal/schedule-2/` contains only
`blank.pdf` — no `instructions.pdf`, no sidecar. This is safe because
`walkCorpus.ts` only acts on folders containing `instructions.pdf`, and
catalog ingest only reads `blank.pdf`. The cross-reference is implicit:
Nynaeve searches `irs-1040-inst-2025` for Schedule 2 content. Apply the
same pattern to any future schedule whose instructions ship inside a
parent booklet rather than as a standalone PDF.

### PR 2 — Bindings + 1099-INT plumbing + Marcus fixture (NEXT SESSION)

Bundles the deferred binding work + the 1099-INT fact builder + the
scenario fixture. Splittable into sub-PRs if it gets unwieldy.

**Known tech debt blocking this PR — repeating-row table fields.**
Schedule B Part I (interest payers) and Part II (dividend payers) enumerate
into ~14 fieldId rows each via the catalog (`schedule-b.0.line.1_payer_1`,
`..._payer_2`, …). Schedule D ran into the same shape and we **avoided
solving it in the general case** — bindings handled a fixed small N
inline. Schedule B will force the question because real returns have
0–N variable payers, and we don't want N bindings hand-written per form.

Two known options when we tackle it:
- **Per-row binding helper** — `bindRows(formId, rowCount, (i) => {...})`
  that generates `payer_N`, `amount_N` bindings programmatically from a
  fact array. Catalog still has the fixed rows.
- **Catalog-level repeating-row primitive** — model a row group as a
  single FormField with `valueType: "rows"` and let the renderer expand
  it. Bigger lift; cleaner for any future form with table sections
  (Form 8889 Part II also has lines like this).

Decide before binding Schedule B Part I; the answer affects how
1099-DIV payer rows already bound on Schedule D feel in retrospect.

**Sub-PR 2a — 1099-INT plumbing.** Adds the typed fact builder + binding
so a scenario can express "Marcus received $700 in HYSA interest." No
scenario fixture in this PR — just the infrastructure and a unit test.

The Wealthfront 1099-INT sample (Andrew's real HYSA statement) informed
our box layout in Phase A. `InterestFactValue` should mirror the
box-1/box-3/box-4/box-8 + state-info (box 15–17) shape we see there.

Files to add/touch (mirror the Dividend pattern):
- `apps/agent/src/mastra/facts/interest.ts` — `InterestFactValue` type +
  `makeInterestFactKey(payerSlug)`. Box 1 (interest income) required;
  box 3 (US savings bond/Treasury), box 4 (federal income tax withheld),
  box 8 (tax-exempt interest), box 15–17 (state info) optional.
- `apps/agent/src/mastra/facts/index.ts` — re-export the new types/helpers.
- 1040 bindings — bind 1099-INT box 1 sum onto **1040 line 2b (taxable
  interest)**. Confirm category = `income`, valueType = `numeric` per the
  FormField contract in `CLAUDE.md`. Box 8 → 1040 line 2a; box 4 → 1040
  line 25b.
- Schedule B Part I bindings (catalog already in place from PR 1).
- Unit test — drop a fact, evaluate the 1040, assert line 2b sums.

**Sub-PR 2b — Schedule A + Schedule 2 bindings.** These are load-bearing
on 1040 totals. Schedule A → 1040 line 12 (itemized deduction). Schedule 2
→ 1040 line 23 (other taxes — carries 8959 + 8960 sums). Wire both before
Marcus's expected-1040 numbers can possibly match the golden.

**Sub-PR 2c — Form 8889 + 8959 + 8960 bindings.** Each form renders
independently from its facts; no downstream 1040 dependency beyond what
Schedule 2 already provides. Bind in any order.

**Sub-PR 2d — Marcus scenario fixture.** Mirror Alejandro's layout
exactly: `apps/agent/tests/scenarios/marcus/{facts.ts, decisions.ts,
expected.ts, expected-540.ts, expected-schedule-ca.ts,
expected-schedule-d.ts, expected-8949.ts, expected-schedule-a.ts,
expected-schedule-b.ts, expected-schedule-2.ts, expected-8889.ts,
expected-8959.ts, expected-8960.ts, index.ts}`. The `expected-*` modules
encode whatever's on the goldens.

## Marcus's profile

**Identity (confirmed):**
- Name: Marcus Chen
- Address: San Francisco, CA (same jurisdiction as Alejandro — reuses CA
  540 and Schedule CA binding work)
- Single, no dependents, full-year CA resident
- Tax year 2025

**W-2 (Helix Software, Inc., SF):**
- Box 1 wages $220,000; box 3 $176,100 (SS cap); box 5 $243,500
- Box 12 code D $23,500 (401(k) max — establishes employer-plan coverage)
- Box 12 code W $4,150 (HSA via payroll — see HSA section)
- Box 14 CA SDI $2,922; box 16 $220,000; box 17 $15,500

**1099-INT (Wealthfront Cash HYSA):**
- Box 1 interest income $700 (only populated box)
- Statement is the full Wealthfront consolidated format — 6 pages,
  everything else $0. Page 3 has monthly interest detail summing to $700.

**Brokerage (Charles Schwab, ~$100k account):**
- 1099-DIV: $3,000 ordinary dividends, $2,000 qualified (4 VTI quarterly
  distributions)
- 1099-B, 4 trades, net +$7,500:
  - **ST**: TSLA +$4,000 / JPM −$1,500 → net +$2,500 ST
  - **LT**: GOOGL +$8,000 / MSFT −$3,000 → net +$5,000 LT

**HSA contribution ($4,150 — 2025 self-only HDHP limit):**
- **Payroll** (W-2 box 12 code W, already pre-tax federally). CA does
  not conform: $4,150 adds back to CA wages on Schedule CA line 1
  column C.
- Form 8889 Part I expected for HDHP-coverage reporting even though
  the contribution itself is already excluded from box 1.

**Nondeductible trad IRA ($7,000 — 2025 limit):**
- $7,000 to Vanguard Traditional IRA on 12/30/2025. Captured verbally
  in `00-marcus-brief.md` — no source PDF (5498 doesn't arrive until
  May; we're treating Marcus's assertion as sufficient).
- MAGI ~$220k > 2025 phase-out ceiling for covered filers + W-2 box 12
  code D proves 401(k) coverage → **fully nondeductible**. Form 8606
  expected; no prior basis.
- **Form 8606 binding is out of scope.** We record the fact + AI
  decision; form binding stays TODO. The scenario tests the
  *decision*, not the form.

**SALT itemize-vs-standard (UPDATED — itemized wins):**
- 2025 SALT cap is $40,000 (OBBBA, signed 2025), with phase-outs starting
  at $500k MAGI. Marcus's MAGI ~$220k → full cap available.
- CA state income tax withheld (W-2 box 17) $15,500 + CA SDI (W-2 box 14)
  $2,922 = **$18,422 SALT**. CA SDI is deductible as a state income tax
  on Schedule A.
- Schedule A line 5e = $18,422 (under $40k cap). Total itemized $18,422 vs
  $15,000 single standard deduction → **itemized wins by $3,422**.
- Confirmed against `Marcus-ScheduleA-Golden.pdf` (CPA-prepared).
- Rule of thumb: any single CA filer with W-2 wages in the ~$180k–$500k
  range will itemize on SALT alone under the new $40k cap. Below ~$180k
  the standard usually wins; above ~$500k the phase-out kicks in.

## Expected AI decisions Thom should record

Thom should call `record-ai-decision` (fires Nynaeve synchronously) for:

1. **`decisions.ira_deduction`** — "nondeductible trad IRA"
   - Supporting facts: trad IRA contribution amount, W-2 box 12 code D
     (proves employer-plan coverage), W-2 box 1 (proves MAGI > phase-out)
   - Rationale: covered + MAGI > phase-out → no deduction
   - Confidence: high; groundable in IRS Pub 590-A
2. **`decisions.itemize_vs_standard`** — "itemized deduction"
   - Supporting facts: CA state income tax withheld (W-2 box 17), CA SDI
     (W-2 box 14, deductible as state income tax), 2025 SALT cap ($40k
     under OBBBA, MAGI under $500k phase-out), standard deduction amount
     for single 2025 ($15,000)
   - Rationale: SALT $18,422 fully deductible under $40k cap → Schedule A
     total $18,422 > $15,000 standard
   - Confidence: high
3. **`decisions.niit_applies`** (if engine derives) — "NIIT applies"
   - MAGI > $200k single → 3.8% on lesser of NII or MAGI excess
   - Form 8960 territory; check whether the engine already handles this

Run `npm run refdocs:status` to confirm IRS Pub 590-A is in the corpus
before expecting Nynaeve to ground decision #1.

## Decisions made (was "still open")

1. **HSA**: payroll (W-2 box 12 code W $4,150)
2. **HYSA bank**: Wealthfront Cash
3. **Trade tickers + amounts**: TSLA / JPM / GOOGL / MSFT — see profile
   block above for proceeds/basis/gain
4. **Brokerage**: Charles Schwab & Co., Inc.
5. **Tech employer**: Helix Software, Inc.
6. **Alejandro's source PDFs were hand-built.** We didn't reuse their
   process — wrote a pdf-lib generator for Marcus (see Phase A).

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
