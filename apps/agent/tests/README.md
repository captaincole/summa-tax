# tests

Scenario tests should cover *EVERY* supported form field at some level. This is the core way that we can establish that our engine is accurate, as all scenarios are CPA reviewed. 

The offline golden suite — `npm test` from the repo root, and what the
pre-commit hook runs. Fast, deterministic, no network, no AI: it exercises
the form engine and PDF fill entirely in memory. Positional args filter by
check name: `npm test -- alex`, `npm test -- catalog-fill`,
`npm test -- form-540`.

Two kinds of checks, one summary table (`runAll.ts`):

- **Scenario goldens** (`scenarios/alex|alejandro|marcus/`) — each scenario
  bundles facts + decisions + per-form expected line values. `runScenario.ts`
  runs the engine over them and asserts every field, then diffs the filled
  PDF against a golden. These are the ground truth for "did the math change".
  - `alex` — single CA filer, one W-2, standard deduction (the canonical case)
  - `alejandro` — adds 1099-INT/DIV investment income
  - `marcus` — adds capital gains (8949 / Schedule D)
- **Catalog-fill checks** (`catalogFill.ts`) — for every form in its
  `CATALOGS` registry: fill the blank PDF with synthetic values for every
  cataloged field and diff against a golden snapshot. Catches widget-mapping
  drift without needing scenario coverage.

## Adding coverage

- **New scenario**: create `scenarios/<name>/` (see `alex/` for the file
  shape: `facts.ts`, `decisions.ts`, `expected.ts`, `index.ts`), add it to
  the `SCENARIOS` array in `runAll.ts`.
- **New form's catalog check**: add an entry to `CATALOGS` in
  `catalogFill.ts`. The first run fails with "no golden — run --update";
  run `npx tsx tests/catalogFill.ts --form-id=<id> --update` (from
  `apps/agent/`) to bootstrap the snapshot, eyeball the PDF it wrote, and
  commit it.

`helpers/` holds the shared assertion/fixture/golden-PDF utilities.

Unit tests are separate: vitest, colocated with the code they test
(`src/engine/**/*.test.ts`, including the engine boundary check) — run via
`npm run test:unit`.
