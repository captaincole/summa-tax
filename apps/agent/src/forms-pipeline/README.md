# forms-pipeline

Dev-time tooling that turns a blank IRS/FTB PDF into the assets the form
engine consumes. Nothing here runs in production — the engine reads the
finished artifacts (`catalog.json`, data tables), never this code.

```
blank.pdf ──ingest──► catalog.json ──promote──► runtime copy ──bind──► bindings.ts draft
```

## Pieces

- **`ingestFormWorkflow/`** — Mastra workflow (run standalone from the CLI,
  not registered on the production instance): extract AcroForm widgets from
  the PDF (`extractFormFields.ts`), AI-label and classify each field
  (`visionLabel.ts`, `classifyFields.ts`), persist a `catalog.json` to
  `apps/agent/forms/<jurisdiction>/<short>/`.
- **`generateBindingsWorkflow/`** — drafts a `bindings.ts` skeleton for a
  cataloged form: retrieves instruction context from the corpus
  (`retrieveContext.ts`), classifies which fields are derivable
  (`classifyBindings.ts`), renders the draft (`renderBindings.ts`). Output
  is a starting point — a human finishes and owns the bindings.
- **`tables/`** — parsers for official rate/tax tables (IRS HTML, FTB PDF)
  into the JSON the engine's `data/` modules load.
- **`renderPageWithOverlay.ts`** — debug renders with widget boxes drawn on
  the page, for eyeballing label↔widget alignment.

## Commands (from repo root)

```bash
npm run forms:ingest             # PDF → catalog.json (Anthropic calls, costs money)
npm run forms:promote            # copy catalog + blank.pdf into src/mastra/public/forms/
npm run forms:bind               # catalog → bindings.ts draft
npm run forms:ingest-tax-table   # refresh the federal tax table JSON
```

The promote step is a deliberate gate: tests run against
`apps/agent/forms/` (offline source of truth); the runtime only sees a
catalog after promotion. AI labeling fence-posts on dense widget clusters —
hand-verified corrections live in `src/engine/render/verifiedWidgets.ts`
and take precedence over catalog widget names at render time.
