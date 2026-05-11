# Forms pipeline — handoff

State as of 2026-05-11. Read alongside `PIPELINE.md` (the design doc).

## What's working

End-to-end AI-generated 1040 pipeline. Thom can ingest a W-2 and have `generate-tax-documents` produce a filled 1040 PDF using the new engine. Smoke test (`npm run smoke:engine`) passes 14/14 assertions on the Alex single-filer fixture ($966.26 refund on $100k wages, $13,533.74 tax).

Wired components:

- **Engine** (`forms/engine.ts`) — module-level binding registry; consumers call exported `register()` from each form's bindings file.
- **Rules** (`forms/rules/`) — 8 rules: `lookupFact`, `sumFacts`, `tableLookupByDecision`, `lookupDecision`, `fromFields`, `constant`, `bracketLookup`, `unsupported`.
- **Catalog** (`fixtures/forms/form-1040-2025.extracted.json`) — 197 fields, AI-extracted; loaded via `forms/catalog.ts`. Also seeded into Supabase `forms` + `form_fields` tables; runtime currently uses the JSON path, flip to `loadFromDb` when DB becomes authoritative.
- **Bindings** (`forms/generated/form-1040.ts`) — 197 bindings, AI-generated. Exports a `register()` function consumers call explicitly. Breakdown: 159 unsupported, 16 fromFields, 7 sumFacts, 5 lookupFact, 5 lookupDecision, 3 constant, 1 tableLookupByDecision, 1 bracketLookup.
- **Workflows** (`forms-pipeline/`) — `ingestFormWorkflow` (PDF → catalog) and `generateBindingsWorkflow` (catalog → bindings). Both are Mastra workflows, run standalone from CLI.
- **CLI** — `npm run forms:ingest`, `forms:bind`, `forms:seed`, `forms:verify`, `smoke:engine`.
- **Renderer** (`tools/generateTaxDocuments.ts`) — walks catalog, fills widgets by valueType. Drops Schedule D / 8949 / 540 entirely (only 1040 supported).
- **Verified widget overlay** (`forms-pipeline/verifiedWidgets.ts`) — hand-corrected widget mapping for fields Phase C drifted on; renderer prefers verified over AI catalog.

## Open TODOs

Ordered by leverage.

### 1. AI binding-shape gaps (add rules, drop renderer special cases)

Two TODOs marked inline in `tools/generateTaxDocuments.ts`:

- **`equalsDecision` rule** (`TODO(rules)`). The AI binds all five filing-status checkboxes to `lookupDecision`, which returns the filing-status string for every widget. Renderer special-cases this with a `FILING_STATUS_FIELD_IDS` map. A new rule `equalsDecision({ decisionKey, value }) → boolean` would let the AI bind each checkbox correctly. Same pattern applies to any future radio-group widgets.
- **Address sub-facts** (`TODO(facts)`). `identity.address` is a single structured fact `{ line1, city, state, zip }`. Catalog has separate `address_street/apt/city/state/zip` widgets but the AI binds only `address_street` and marks the rest `unsupported`. Renderer parses and decomposes at fill time. Split at ingest time so the AI can bind each sub-field directly with `lookupFact`.

### 2. Phase C extraction quality

The AI fence-posts on densely-clustered widgets: 1040 header shifted into spouse slots, address widgets off by 2 positions, income lines off by 1. `verifiedWidgets.ts` overlays corrections for the 1040; the underlying Phase C prompt needs improvement so future forms don't need manual overlays.

Approaches to try:
- Tighter prompt with IRS widget-name conventions (e.g. `f1_14` is primary taxpayer; `f1_19+` is spouse).
- Position-based validation: pass the full widget table sorted by position, ask the model to verify alignment after labeling.
- Operator confirmation step for adjacent widgets sharing labels.

Once Phase C is reliable, delete `verifiedWidgets.ts`.

### 3. Phase F: re-enable Schedule D / 8949 / CA 540

The old per-form files (`forms/form1040.ts`, `forms/form540.ts`, `forms/form8949.ts`, `forms/scheduleD.ts`, `forms/render/*`) are orphaned — no longer imported in `src/`. Migrating each needs its own Phase C run (extract catalog), Phase D run (generate bindings), and `register()` import wired into `caseState.ts` + `generateTaxDocuments.ts`. After Schedule D is back, rebind 1040 line 7a from `unsupported` to `fromFields` referencing `schedule-d.line.16`.

### 4. Mastra dev hot-reload for bindings

After `npm run forms:bind`, the dev server doesn't reliably re-evaluate `forms/generated/form-1040.ts` — manual `mastra dev` restart is required. Worth checking whether Mastra dev watches that path or treats it as ignored. The empty-1040 bug today was at least partly explained by this — bindings file was regenerated but dev process kept the old module scope.

### 5. Flip caseState + generator to DB catalog

Both currently load `loadFromFixtures([form-1040-2025.extracted.json])`. The DB tables (`forms`, `form_fields`) are seeded with the same data via `npm run forms:seed`. When we trust the DB path, change both call sites to `loadFromDb(supabase, year)`. One-line each.

### 6. PIPELINE.md drift

The design doc was sharpened before Phase A built anything. Real work added concepts not in the original plan:

- 8th rule `unsupported` (engine-gap marker, not in the original 6).
- `register()` wrapper pattern (replaces the side-effect-import idiom shown in the doc).
- `verifiedWidgets.ts` overlay (acknowledges the Phase C drift issue the doc didn't anticipate).
- DataLoader/coalescer pattern is implemented inside `classifyBindings.ts`; the doc described it as a workflow concern.

Worth a refresh pass to capture what actually shipped.

### 7. Other cleanup

- Delete orphaned old form files (`forms/form*.ts`, `forms/render/*`) once we're sure nothing references them — currently just dead weight.
- Smoke test could grow scenarios beyond Alex: MFJ filer, taxpayer with Schedule D, taxpayer with dependents. Each one will exercise different binding paths and likely surface more AI quirks.

## Quick mental model for the next session

The engine walks the **catalog's** fields in ordinal order. For each field, it looks up a **binding** keyed by `fieldId`. The binding's rule + params evaluate against the fact/decision context. Catalog and bindings must share the same `fieldId` set.

- **Phase C** (PDF → catalog) is the AI authority for "what fields exist on this form."
- **Phase D** (catalog → bindings) is the AI authority for "what rule + params each field uses."
- **Renderer** maps each evaluated field to its PDF widget via `pdfWidgetName` (from the catalog, overlaid by `verifiedWidgets.ts` where the AI drifted).

Where the AI gets things wrong, the fix path is:

1. If the binding shape doesn't exist in our rule library → add a new rule (e.g. `equalsDecision`).
2. If the binding params are wrong → tighten the Phase D prompt in `classifyBindings.ts`.
3. If the widget mapping is wrong → add to `verifiedWidgets.ts` (short-term) or improve Phase C extraction (long-term).
4. If the field doesn't even exist in the catalog → improve Phase C extraction (or it really should be `unsupported`).

`npm run smoke:engine` is the regression check — it runs the full engine against a known fixture and asserts specific line values. Run it after any change to rules, the renderer, or the bindings file.
