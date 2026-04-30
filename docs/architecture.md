# Wheel of Time — Data Architecture

This document captures the layered data model the engine is being built around.
It exists to keep the design coherent as we expand beyond the W-2-only MVP into
investments, multi-state, and eventually full HNW returns.

Status: working design. Implemented portions are called out per layer.

## The four layers

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Bronze — source documents                                              │
 │   Original PDFs, images, statements. Includes synthetic entries for    │
 │   verbal confirmations so every fact has a parent. Immutable.          │
 └────────────────────────────────────────────────────────────────────────┘
                                 │ extract
                                 ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Silver — facts + AI decisions                                          │
 │   tax_facts: structured rows pulled from a Bronze doc, with hard FK    │
 │   back to source_doc_id.                                               │
 │   ai_decisions: every interpretive judgment with rationale, supporting │
 │   fact keys, and Nynaeve verdict + citations from the ref corpus.      │
 │   Together these are the ground truth the engine reasons over.         │
 └────────────────────────────────────────────────────────────────────────┘
                                 │ derive
                                 ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Form Engine — FormSpecs + derivations                                  │
 │   Static registry: each form (1040, Schedule D, 8949, CA 540, …)       │
 │   declares a mustFile derivation and a list of line derivations.       │
 │   At render time, derivations read facts + decisions and produce       │
 │   form-line values. Pure aggregation (sums, math, table lookups) is    │
 │   code; classification or judgment is always an AI-decision lookup.    │
 └────────────────────────────────────────────────────────────────────────┘
                                 │ render
                                 ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ Marts — rendered outputs                                               │
 │   (a) Tax filings: filled-out federal 1040, Schedule D, Form 8949,     │
 │       CA Form 540 (PDFs from ref/forms/ with line values filled in).   │
 │   (b) Advisory summary: human-reviewable digest for a CPA.             │
 │   (User dashboard is a future Mart — not in this iteration.)           │
 └────────────────────────────────────────────────────────────────────────┘
```

The same fact + decision state drives every Mart. The same realized $10k
stock gain shows up once in `tax_facts` (with the LT classification recorded
once in `ai_decisions`) and is then projected onto **federal** as long-term
capital gain (15/20% bracket, 1040 line 7 via Schedule D) and onto **CA** as
ordinary income (no LT/ST split). The book-to-tax differences live in the
projection layer of each FormSpec, not in the underlying data.

## AI decisions as the uniform interpretive path

Every interpretive derivation in the Form Engine goes through `ai_decisions`.
There is no "mechanical fast path" branching inside a derivation that decides
when to invoke AI judgment vs. when to read facts directly. Either:

- The derivation is **pure aggregation** (sum of W-2 box 1s → 1040 line 1a;
  taxable income = AGI − standard deduction; tax bracket lookup) — this stays
  in code, no AI involved.
- The derivation is **classification or judgment** (residency status, LT/ST
  split, "is this $200 inflow interest or refund?", "is this trade a wash
  sale?", filing-status eligibility, threshold applications) — this *always*
  defers to a recorded AI decision, even when the user-stated facts make the
  answer obvious.

The agent records these via `record-ai-decision`. Nynaeve grounds each one
synchronously against the ref corpus. Trivial cases ("user said full-year CA,
no conflicting facts → CA full-year resident") get short rationales and
trivial verdicts; ambiguous cases ("4 months in NV, primary domicile CA")
get longer rationales and richer fact lists. The code path is identical.

Why this uniform path:

- **Audit trail uniformity.** Every conclusion the engine relies on has an
  `ai_decisions` row with rationale, supporting facts, and citations. A CPA
  reviewing a return can trace any line back through one mechanism.
- **No branching logic in form-line authors.** A FormSpec line declares
  "this depends on `decisions.X`"; the engine handles lookup, blocking, and
  re-render. No conditionals on "is this case clean enough to skip AI?"
- **Render determinism.** Given a fixed (facts, decisions) state, every
  FormSpec evaluates to the same line values. The LLM only enters during
  the conversation that *records* decisions — never at render time.
- **Tests stay cheap.** Unit-test a FormSpec by feeding it a fixture of
  facts + decisions. No tokens spent.

## The audit-trail invariant

**Every Silver fact has a Bronze parent.** No exceptions.

When a fact comes from a real document — a W-2 PDF, a 1099 statement — the
Bronze row is the document. When a fact comes from verbal confirmation
("yes, I rented the whole year"), we still write a Bronze row of kind
`verbal`, capturing what the user said and when. That keeps the audit trail
unbroken: any number on a return can be traced back to *something* — a
document we hold, or a recorded verbal exchange.

`source_kind` discriminates:
- `document` — Bronze row points at a stored file (W-2 PDF, 1099, etc.)
- `verbal` — synthetic Bronze row, captures the user's literal statement + timestamp
- `derived` — Silver value computed from other Silver values within the same ingest step (e.g. W-2 box 12 code D → 401(k) contribution fact)

## What lives where (current vs. proposed)

| Layer       | Today                                          | After this work                                                |
|-------------|------------------------------------------------|----------------------------------------------------------------|
| Bronze      | None — source PDFs are not stored              | NEW: `source_documents` table + filesystem (or S3 later)       |
| Silver      | `tax_facts` table + `ai_decisions` table       | `tax_facts` extended with `source_doc_id` FK + `source_kind`   |
| Form Engine | Case engine reads facts directly per form line | NEW: `FormSpec` registry per form, with `mustFile` + line derivations |
| Marts       | Single draft 1040 generator                    | Refactored to render any FormSpec into its filled-out PDF      |

## First slice — Alejandro through all four layers

Smallest end-to-end exercise of the architecture. Alejandro: single CA
filer, $100k W-2 from one employer, single brokerage with dividend income
plus two realized sales (one short-term + one long-term, both covered, no
wash sales). The W-2 path gets migrated through the new layers in the same
pass — we don't leave a parallel old path to rot.

1. **Fixture.** ✓ Done. `fixtures/scenarios/03-investments-dividends.{md,ts}`
   describes the case. Renderer at `fixtures/pipeline/renderers/1099consolidated.ts`
   emits a real synthetic 5-page consolidated 1099 PDF (cover + Copy B summary
   + 1099-DIV detail + 1099-B totals summary + 1099-B trade detail).

2. **Reference corpus.** ✓ Done. Ingested Schedule D instructions, Form 8949
   instructions, and CA 540 booklet alongside the existing 1040 instructions.
   Nynaeve can ground decisions against any of these via `search-ref-docs`.

3. **Bronze.** New `source_documents` table; filesystem storage for the file
   bytes; reset wipes the dir like other generated artifacts. Synthetic
   verbal Bronze rows for facts that come from chat rather than uploads.

4. **Silver — `tax_facts` extension.** Add `source_doc_id` FK + `source_kind`
   column. Migrate `ingest-w2-structured` to write Bronze + Silver. Add new
   `ingest-1099-consolidated` mirroring the W-2 ingest pattern.

5. **Form Engine — FormSpecs.** Author the four forms Alejandro needs:
   federal 1040, Schedule D, Form 8949, CA Form 540. Each FormSpec declares:
   - a `mustFile` derivation (always defers to an `ai_decisions` lookup —
     even for the obvious cases)
   - per-line derivations: pure aggregation for sums and math; AI-decision
     lookups for any classification or judgment

6. **Marts.** Render each populated FormSpec into a filled-out PDF using the
   templates in `ref/forms/`. Replaces the current draft-1040 generator.

When this slice ships, scenarios 01 (wages-only) and 03 (wages + investments)
both flow Bronze → Silver → Form Engine → Marts. There's no fact-direct-to-form
path left.

## Decisions already made (don't re-litigate without cause)

- **Form Engine is recomputed on read, not materialized.** Facts +
  ai_decisions are the source of truth; FormSpec evaluation is a pure
  function of those. No cache invalidation problems.
- **Every interpretive derivation defers to ai_decisions.** No mechanical
  fast paths. Trivial cases get trivial decisions; ambiguous cases get
  richer ones. Same code path. (See "AI decisions as the uniform
  interpretive path" above.)
- **Pure aggregation stays in code.** Sums, line-to-line arithmetic, tax
  bracket lookups don't need to be AI decisions — they're just math on
  values that themselves came from facts or decisions.
- **Investment accounts get human-readable slugs**, not UUIDs
  (`apex-individual`, not `acc_a8f3d…`). Both Thom and the user reference them.
- **Verbal confirmation is a synthetic Bronze row**, not a fact without a
  parent. Audit trail stays unbroken.
- **W-2 path gets migrated in the same iteration as the investment work.**
  No parallel old path left behind.
- **Iterate on FormSpec shape as we author it.** Start with Alejandro's four
  forms (1040, Schedule D, 8949, CA 540), test each, refine the types as
  missing information surfaces. Don't try to design the universal FormSpec
  up front.
- **Cross-form reference cycles: handle them when they show up.** Don't
  pre-design a no-cycle resolver. The IRS form set isn't guaranteed to be a
  DAG; if we hit a cycle, make the judgment call at that point.
- **Parser granularity for new ref docs: let Nynaeve failures drive it.**
  Don't pre-tune `KNOWN_PROSE_HEADINGS` for Schedule D, 8949, or CA 540
  ingests. Revisit only when grounding quality on a specific decision is
  visibly bad.

## Testing per layer

Each layer has a distinct testability story. Tests at one layer don't depend
on the layer above being correct. All of these are deterministic pipeline
tests — no LLM involvement, fast to run.

| Layer        | Test type                            | Question it answers                                                       |
|--------------|--------------------------------------|---------------------------------------------------------------------------|
| Bronze       | unit                                 | Does the file get stored and indexed correctly? Are synthetic verbal rows created with the right metadata? |
| Silver       | unit + ingest integration            | Given a Bronze doc (real or synthetic), does the ingest tool write the right structured facts with correct `source_doc_id` + `source_kind`? |
| Form Engine  | unit (pure function) + snapshot      | Given a (facts, decisions) fixture, does each FormSpec evaluate `mustFile` and every line derivation correctly? Same input → same output. |
| Marts        | snapshot                             | Given a populated FormSpec, do the right values land in the right PDF fields? |

Concretely, the test surface for the Alejandro slice:

- `tests/bronze/sourceDocs.test.ts` — write a verbal Bronze row, write a
  document Bronze row, verify storage + retrieval.
- `tests/silver/ingestW2.test.ts` and `tests/silver/ingest1099Consolidated.test.ts`
  — given a structured payload, verify the Silver rows written and the
  Bronze→Silver linkage.
- `tests/forms/form1040.test.ts` (and one per form) — feed each FormSpec a
  fact+decision fixture; assert `mustFile` and every line value.
- `tests/marts/render1040.test.ts` (and one per form) — snapshot the filled
  PDFs against expected.

End-to-end tests (PDF render → agent → final 1040) and agent-quality evals
(did the agent extract the right facts, make the right judgment) are
deferred — see "out of scope" below.

## Out of scope for this iteration

- **Multi-year scope.** Engine scopes to a single tax year for now.
- **Corrected / amended statements.** Bronze rows are write-once; revisit
  versioning later.
- **User dashboard.** Future Mart. Header counters in Chat are sufficient
  for now.
- **End-to-end tests + agent-quality evals.** Deterministic per-layer tests
  cover the pipeline; LLM-driven tests are deferred until the architecture
  settles.
- **Personal Balance Sheet + Personal P&L for individuals.** Considered
  earlier and rejected: HNW *individuals* don't benefit from GAAP-style
  statements. BS + P&L re-enter the picture only when we model **owned
  entities** (single-member LLC → Schedule C, rental property → Schedule E,
  trust → 1041 / K-1). Out of scope for Alejandro.
- FBAR / foreign reporting.
- K-1, Schedule E (rental), Schedule C (self-employment).
- Trade-level wash-sale reconstruction (broker-reported wash flags only).
- Externalizing the ref corpus to a managed DB (Supabase, etc.) — fine
  on Render's persistent disk for now.

These all fit the layered model — they're future Marts and future FormSpec
extensions, not architectural changes.
