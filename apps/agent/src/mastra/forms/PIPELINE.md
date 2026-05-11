# Form Engine — AI-Ingestion Pipeline

This document captures the plan for moving from hand-coded TypeScript per output form to a two-stage AI ingestion pipeline. **Scope: output forms only** (the 1040, 540, Schedule D, etc.). Input documents (W-2, 1099 from various brokers) stay as typed ingest tools because per-provider variance is genuinely different per source — defer that to its own pipeline.

The current hand-coded `form1040.ts` / `form540.ts` / `form8949.ts` / `scheduleD.ts` files are **scaffolding**. They exist to validate the runtime data shape (`BaseFormField`, `Category`, `FieldValueType`, the `EvaluatedForm.fields` array, the `categorize()` function). Once the pipeline lands, they get replaced by AI-generated files.

## Today vs. the new shape

| Concern | Today | New shape |
|---|---|---|
| Form field inventory (labels, positions) | Hand-coded in `formXxx.ts` | Extracted by AI → rows in DB |
| Derivation logic | Hand-written inline (~400 lines/form) | Generated TS: ~50-100 lines/form referencing a small rule library |
| Rule library | Mixed into form code | Standalone, hand-written, audited, ~6-10 rules |
| Must-file logic | Hand-coded per form | Always an AI decision (`record-ai-decision`) |
| Lookup tables (std deduction, brackets) | Hand-coded constants | Generated TS files (regeneratable) — DB-backed later |

The per-form cost drops from ~400 lines to ~50-100 generated lines. The rule library is the bounded surface that engineers maintain by hand.

## Two-part pipeline

Both parts run as Mastra workflows so we get step-level persistence, structured outputs, and resumability. **Neither workflow is registered in the production Mastra instance** — they live in `apps/agent/src/forms-pipeline/` and are invoked from CLI scripts (`apps/agent/scripts/ingestForm.ts`).

### Part 1 — Form PDF → field inventory in DB

```
PDF + form metadata
        │
        ▼
┌─────────────────────────┐
│ extractRawText          │   pdf-lib / unpdf → per-page text
└─────────────────────────┘
        │
        ▼
┌─────────────────────────┐
│ extractFields           │   Claude with structured output
│                         │   → array of { fieldId, label, valueType,
│                         │     pdf_widget_name, position }
└─────────────────────────┘
        │
        ▼
┌─────────────────────────┐
│ writeFormRecords        │   upsert into `forms` + `form_fields`
└─────────────────────────┘
```

### Part 2 — Fields + Instructions → generated bindings

```
form_fields (from DB) + instructions PDF
        │
        ▼
┌─────────────────────────┐
│ loadFieldsAndContext    │   pull fields from DB, extract instructions text
└─────────────────────────┘
        │
        ▼
┌─────────────────────────┐
│ classifyBindings        │   per-field Claude call (.foreach step)
│                         │   → { ruleName, ruleParams } per field
└─────────────────────────┘
        │
        ▼
┌─────────────────────────┐
│ renderGeneratedFile     │   write generated/form-1040.ts
└─────────────────────────┘
```

Stage 2 records a row per field in `form_ingestion_run_steps` for the same auditability we get on Nynaeve's reviews.

## Data model

### DB tables (new)

```sql
forms                       -- one row per (formId, taxYear)
─────────────────────────────────────────────────
id              text primary key       -- "form-1040"
tax_year        integer
title           text                   -- "U.S. Individual Income Tax Return"
jurisdiction    text                   -- "federal" | "state-ca" | …
must_file_decision_key text             -- e.g. "decisions.must_file.form_1040"

form_fields                 -- one row per fillable field per form
─────────────────────────────────────────────────
id              text primary key       -- "form-1040.line.1a"
form_id         text references forms(id)
label           text
category        text not null          -- Category enum
value_type      text not null          -- FieldValueType enum
pdf_widget_name text                   -- e.g. "f1_3"
position        jsonb                  -- { page, x, y } for renderers
```

`lookup_tables` is **deferred** — for now standard deductions / tax brackets stay as generated TS exports alongside their binding files. Move to DB when there's a second use case that wants programmatic table access.

### Generated TS — the binding files

One file per form, lives at `apps/agent/src/mastra/forms/generated/<formId>.ts`. Fully regeneratable: each run **completely overwrites** the file. No `@ai-generated` markers, no manual override preservation. If you need to hand-fix something, fix the AI prompt or fix the rule, not the generated file. Keep it simple until that pain shows up.

```ts
// generated/form-1040.ts
import { bindField, bindMustFile } from "../engine";
import * as r from "../rules";

bindMustFile("form-1040", r.lookupDecision, {
  decisionKey: "decisions.must_file.form_1040",
});

bindField("form-1040.header.first_name", r.lookupFact, {
  factKey: "identity.name.first",
});

bindField("form-1040.line.1a", r.sumFacts, {
  category: "wages",
  keyPrefix: "employer.",
  fieldPath: "box1",
});

// … one bindField per row in form_fields for this form
```

### Rule library — hand-written, audited

`apps/agent/src/mastra/forms/rules/`. Six rules cover the expected cases:

| Rule | Used for | Example |
|---|---|---|
| `lookupFact` | direct fact mapping | first name → `identity.name.first` |
| `sumFacts` | aggregate over typed facts | line 1a → sum of W-2 box 1s |
| `tableLookupByDecision` | bracket / std-ded style lookups | line 12 standard deduction |
| `lookupDecision` | filing status / must-file / scope calls | filing_status field |
| `fromOtherFormField` | cross-form references | line 7 from Schedule D line 16 |
| `constant` | placeholder / known-zero | line 10 (Schedule 1 adjustments — zero for MVP) |

Each rule is a pure function `(params, ctx) => DerivationResult<V>`. Params are validated by Zod at registration time so the generated code can't reference a rule with the wrong param shape.

We'll need more rules over time but the count grows slowly — most new forms reuse existing rules with new params.

## Three worked examples

These are the three field types we walked through to validate the model.

### Example 1 — Line 1a: Total wages (sum across facts)

**DB row (Part 1 output, AI-extracted):**
```
id:               "form-1040.line.1a"
label:            "Total amount from Form(s) W-2, box 1"
category:         "income"
value_type:       "numeric"
pdf_widget_name:  "f1_3"
```

**Generated binding (Part 2 output):**
```ts
bindField("form-1040.line.1a", r.sumFacts, {
  category: "wages",
  keyPrefix: "employer.",
  fieldPath: "box1",
});
```

**Rule:**
```ts
export const sumFacts = rule({
  params: z.object({
    category: z.string(),
    keyPrefix: z.string(),
    fieldPath: z.string(),
  }),
  evaluate(p, ctx) {
    const rows = ctx.facts.byCategory(p.category)
      .filter(r => r.key.startsWith(p.keyPrefix));
    let total = 0;
    const keys: string[] = [];
    for (const row of rows) {
      const v = getPath(row.value, p.fieldPath);
      if (typeof v === "number") { total += v; keys.push(row.key); }
    }
    return ok(total, `Sum of ${p.fieldPath} across ${rows.length} ${p.category} rows.`, keys);
  },
});
```

### Example 2 — Line 12: Standard deduction (table lookup by decision)

**DB row:**
```
id:         "form-1040.line.12"
label:      "Standard deduction"
category:   "deductions_credits"
value_type: "numeric"
```

**Generated binding + table (same file):**
```ts
export const STD_DEDUCTION_2025_FEDERAL = {
  single: 15000,
  married_filing_jointly: 30000,
  married_filing_separately: 15000,
  head_of_household: 22500,
  qualifying_surviving_spouse: 30000,
};

bindField("form-1040.line.12", r.tableLookupByDecision, {
  decisionKey: "decisions.scope.filing_status",
  table: STD_DEDUCTION_2025_FEDERAL,
});
```

Tables ship inline in the generated TS for now — auditable in PRs, no schema migration needed when amounts change yearly. DB-backed tables become valuable when we want programmatic access from multiple bindings; not yet.

### Example 3 — Line 7: Capital gain (cross-form reference)

**DB row:**
```
id:         "form-1040.line.7"
label:      "Capital gain or (loss). Attach Schedule D if required"
category:   "income"
value_type: "numeric"
```

**Generated binding:**
```ts
bindField("form-1040.line.7", r.fromOtherFormField, {
  sourceFormId:  "schedule-d",
  sourceFieldId: "schedule-d.line.16",
  whenSourceNotRequired: 0,
});
```

The `fromOtherFormField` rule handles the three states: source not required (use fallback), source required but blocked (propagate block), source required and ok (use value). Reused for every state form's reference into the federal forms.

## Must-file decisions — always AI

Per the simplification: every form's `must_file` is an AI decision recorded via `record-ai-decision`, never a hand-coded derivation. The form metadata just names the decision key; the engine reads it the same way it reads any other AI decision.

The agent (Thom or a specialist) is responsible for recording the must-file decision based on the case context. Nynaeve grounds it against the IRS reference corpus the same way she reviews any other AI decision. This means:

- No `mustFileForm1040(ctx)` hand-written function
- The "should this be filed?" answer is auditable: rationale, supporting facts, Nynaeve's verdict, all in `ai_decisions`
- New forms don't need a new must-file derivation — just a new decision key in the form metadata

Assumption: **the agent knows all the potential forms it might file**. This means there's a top-level registry of eligible forms (federal + state for the user's residency) somewhere — separate from per-form derivation. Probably a config constant, deferred to its own design.

## Testing strategy

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Rule unit tests          (no DB, no Claude)               │
│    Pure-function tests: given a mock ctx, sum_facts returns  │
│    the right total. Fast, run in CI.                         │
├──────────────────────────────────────────────────────────────┤
│ 2. Catalog extraction tests (no DB — golden fixture diffs)   │
│    Run Stage 1 on a checked-in PDF, diff against a known-good│
│    JSON fixture. Catches AI extraction drift between runs.   │
│    Run when re-ingesting forms or after model upgrades.      │
├──────────────────────────────────────────────────────────────┤
│ 3. Scenario integration     (in-memory catalog loader)       │
│    A `Catalog` interface with two loaders:                   │
│      loadCatalogFromDb(supabase)                             │
│      loadCatalogFromFixture(path)                            │
│    Tests use the fixture loader, run the engine, snapshot.   │
│    The fixture JSON files become reviewable artifacts.       │
├──────────────────────────────────────────────────────────────┤
│ 4. End-to-end (rare)        (real DB, real ingest)           │
│    Wipe → ingest fixtures → run engine → snapshot. Slow,     │
│    pre-deploy or pre-release.                                │
└──────────────────────────────────────────────────────────────┘
```

The `Catalog` interface is the key abstraction that makes layers 2 and 3 fast and deterministic. Engine code never reads from DB directly — it operates over a `Catalog`.

## Things we explicitly chose NOT to do

Captured so future-us doesn't reopen them:

### AI-decided derivations (not just must-file)
Considered: AI classifies each fact and produces derivation rules dynamically. **Rejected.** Derivations bind to OUR fact schema, which an LLM can't know without our schema in context. Even with that context, "AI decides this is a sum" is less defensible than "the registry says line 1a binds to `sumFacts` with these params." Determinism + audit trail wins.

### DB-driven bindings
Considered: bindings live as rows in `field_bindings`, loaded at runtime. **Rejected.** Bindings reference TS rule functions and need type safety on their params. Generated TS catches mismatches at compile time; DB rows would catch them at runtime. Code is reviewable in PRs; DB rows aren't. Generated TS won on both ergonomics and safety.

### AI-marker preservation on regeneration
Considered: each binding gets `// @ai-generated`, regen only touches marked ones. **Rejected for now.** Adds complexity before we know we need it. Simpler rule: regeneration overwrites the whole file. If we hand-fix something we lose it on regen; that pain forces us to fix the AI prompt or the rule library instead. Revisit if hand-fixes pile up.

### Lookup tables in DB
Considered: standard deductions, tax brackets, EITC tables as DB rows. **Deferred.** For now they live inline in generated TS files. DB-backed tables become valuable when we want programmatic access from many bindings or runtime table updates without a deploy. Neither is true yet.

### Composite must-file rules (`any_of`, `all_of`)
Considered: a must-file rule that ORs/ANDs other rules. **Rejected** — replaced by "must-file is always an AI decision." The judgment that goes into "Schedule D required if (sales OR cap_gain_distributions)" lives in Nynaeve's review and Thom's prompt, not in a composite-rule DSL.

### PDF rendering auto-generation
Considered: walk `form_fields.pdf_widget_name` and a generic renderer fills any form. **Deferred.** Renderer logic varies per form (radio groups, repeating sections, multi-page handling). Auto-generate as Phase 2 once the binding pipeline is stable.

### Two-file split for generated + override
Considered: `generated/form-1040.ai.ts` (regeneratable) + `generated/form-1040.overrides.ts` (human, takes precedence). **Rejected.** Adds cognitive load — two places to look for any binding. Simpler to overwrite the single file and accept that the AI prompt is the source of truth.

## Open questions / deferred work

- **Top-level form registry.** When the engine asks "which forms apply to this taxpayer?", what's the source of truth? Probably a hardcoded list of eligible forms per jurisdiction + tax year. Designed alongside the pipeline once we're ingesting >1 form.
- **PDF renderer auto-generation.** Phase 2, once bindings prove out.
- **`lookup_tables` DB table.** When we have a second consumer or want runtime updates.
- **Catalog hot reload during dev.** Right now editing a generated file requires a server restart to take effect. Probably fine; revisit if we're iterating heavily on bindings.
- **Form ingestion run history.** Mirror of `review_runs` — track which forms were ingested when, with which model, with what AI confidence. Useful for debugging extraction drift.

## Relationship to current code

The work in this session (renames `BaseLine` → `BaseFormField`, addition of `category` + `valueType`, header fields modeled as FormFields, `categorize()` function) is **scaffolding that validates the runtime data shape**. Once the ingestion pipeline lands, the hand-coded `formXxx.ts` files are replaced by generated files. The types in `forms/types.ts` survive; the per-form files get regenerated.

Plan: ship the current scaffolding to lock in the data shape, then start building the ingestion pipeline in a subsequent session.
