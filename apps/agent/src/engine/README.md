# The Form Engine

The deterministic core of Summa. Facts and decisions go in, evaluated tax
forms come out. **No AI anywhere in the math** — every line on every form is
computed by a typed, pure-function derivation you can read, test, and diff.

```
evaluateScenario({ filing, facts, decisions })  →  EvaluatedScenario (all forms)
renderForm(scenario, formId)                    →  filled PDF bytes
```

## The three rules

1. **The engine imports nothing outside `src/engine/`** — no Mastra, no db
   layer, no AI, no network. The only exceptions: node builtins, `zod`,
   `pdf-lib`, and the bundled catalog JSON assets under
   `src/mastra/public/forms/`. `boundary.test.ts` enforces this on every
   commit; if your change fails it, the fix is to move code or pass data in,
   never to widen the whitelist casually.
2. **The engine does no I/O** beyond reading its own blank PDFs. Callers load
   fact/decision rows and pass them to `evaluateScenario` — the runtime
   bridge is `src/mastra/loadScenario.ts`, the only place db and engine meet.
3. **The engine owns its vocabulary.** `facts/rows.ts` defines what a fact
   and a decision look like; the db layer imports those types, not the other
   way around.

## Layout

```
engine/
├── index.ts          public API: evaluateScenario, renderForm
├── engine.ts         fixpoint evaluator (cross-form refs converge in ≤5 passes)
├── types.ts          FormField model, DerivationContext
├── filingInfo.ts     facts + decisions → typed FilingInfo projection
├── catalog.ts        widget catalogs (fieldId → PDF widget inventories)
├── formSpec.ts       FormSpec shape shared by jurisdiction registries
├── registry.ts       composes federal + state into the global FORMS list
├── facts/            fact vocabulary: row shapes + per-kind key conventions
├── data/             federal tables (rate schedules, tax table, std deduction)
├── worksheets/       shared computations (QDCG, …)
├── render/           PDF fill (fillFromCatalog + hand-verified widget overrides)
├── federal/          one folder per federal form + federal registry (index.ts)
└── state/
    ├── index.ts      one import + one spread per supported state
    └── ca/           CA registry + one folder per CA form (+ ca/data/ tables)
```

Form assets live in two mirrored trees keyed by the same `relativeDir`:
`apps/agent/forms/<relativeDir>/` (offline source of truth, used by tests)
and `src/mastra/public/forms/<relativeDir>/` (promoted runtime copy, bundled
by Mastra and shipped next to the deployed function).

## Adding a form

1. Drop `catalog.json` + `blank.pdf` into `apps/agent/forms/<jurisdiction>/<short>/`
   and promote the runtime copy into `src/mastra/public/forms/<jurisdiction>/<short>/`.
2. Create `<jurisdiction>/<short>/` here with `types.ts` (the form's
   FormFields — every field must declare `category` and `valueType`; TS
   won't compile otherwise), `filingInfo.ts`, and `bindings.ts`.
3. Add a `makeFormSpec` entry (+ catalog import) to the jurisdiction's
   `index.ts`.
4. Add golden coverage under `tests/scenarios/`.

If a new form makes you touch files outside its folder and its jurisdiction
registry, the registry isn't doing its job — surface the missing abstraction
instead of papering over it.

## Adding a state

1. Create `state/<st>/` containing the state's forms (step 2 above per
   form), its `index.ts` exporting `<ST>_FORMS` + `<ST>_CATALOGS`, and its
   data tables under `state/<st>/data/`.
2. Add one import + two spreads in `state/index.ts`.

That's the whole diff outside your state's folder. States may read core and
federal results (CA 540 reads federal AGI cross-form) but never each other.

## Conventions

- **Whole-dollar rounding is `Math.ceil`**, always up, never `Math.round` —
  see the QDCG worksheet for the pattern and CLAUDE.md for the CPA rationale.
- **Never invent a number.** A field whose inputs are missing evaluates to
  `blocked` with a reason — that's what feeds the open-questions list.
- **Tax years are parameter-keyed data** (tables take `taxYear`), not
  directory-per-year. Revisit only when a second filing year ships.
