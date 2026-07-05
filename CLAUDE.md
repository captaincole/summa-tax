# Project Summa — Claude Development Guide

## What this is

**Summa** is an AI CPA platform for high-net-worth individuals (HNWIs). Target user has W-2 income of $400k+/yr and $2–5M in investable assets, often with RSUs, K-1s, rental property, multi-state or foreign exposure, crypto, and meaningful charitable giving. The name nods to Luca Pacioli's *Summa de arithmetica* (1494), the book that first described double-entry bookkeeping.

Agents on the platform:

- **Luca** — the conversational front-desk agent (named after Pacioli); guides the user through the tax-prep flow, orchestrates workflows, narrates progress. First agent built.
- **Nynaeve al'Meara** — critic agent; reviews every `record-ai-decision` synchronously and grounds it (or flags it) against the IRS reference corpus. Runs on Haiku 4.5. See "Reference-document RAG" section. _(Legacy Wheel-of-Time name; this agent is being removed in the open-source transition's Phase 3 — see `OPEN_SOURCE_TRANSITION.md` — so it was deliberately not renamed.)_

Note: the Unix working directory is still `project-merrilin` (the product's earliest name; later "Wheel of Time," now "Summa"). The directory name was left alone to avoid churning local paths/configs. Internal names / IDs / docs use "summa" or "Summa".

The end goal is a three-stage workflow:

1. **Gatherer** (Stage 1, where we are now) — Luca runs conversational intake that captures structured tax facts with citations and produces a live-updating case state (draft 1040, open asks, decisions).
2. **Summarizer** (Stage 2, not built yet) — turns gathered facts into a human-reviewable tax summary / organizer.
3. **Preparer** (Stage 3, not built yet) — fills out the actual forms (1040 + schedules, state returns). Human-in-the-loop is mandatory; a CPA signs off.

Everything routes through a `tax_facts` table (libsql/SQLite, `.data/app.db`) where each row has a `source_note` citing where the value came from. No fact exists without a citation.

## Repo structure

This is a monorepo. Two independent deploy units, each with its own `package.json` and lockfile:

```
apps/
├── agent/                       # Mastra backend → deployed to Vercel
│   ├── src/mastra/              # agent code (Luca, Nynaeve, tools, db, server, workflows)
│   ├── src/refdocs/             # reference-corpus ingest pipeline (parse, contextualize, embed)
│   ├── fixtures/                # canonical test scenarios + PDF render pipeline
│   ├── scripts/                 # operator scripts (refdocs:*, smoke:review, etc.)
│   ├── forms/                   # one folder per tax form: blank.pdf (fillable template),
│   │                              catalog.json (widget inventory), instructions.pdf
│   │                              (IRS booklet), instructions.meta.json (corpus metadata),
│   │                              instructions.canonical.txt (extracted text). Federal
│   │                              forms under federal/<short>/, state under state/<st>/<short>/.
│   ├── package.json             # agent deps + scripts (mastra dev, fixtures:build, refdocs:*)
│   └── tsconfig.json
└── web/                         # Next.js 16 (App Router) frontend → deployed to Vercel
    ├── app/                     # /login, (app)/{page,documents,activity}, /documents/[id] route handler
    ├── components/              # AppShell, SideNav, ActivityCard, Markdown
    ├── lib/                     # supabase/{client,server,proxy}, activity, api, mastraClient, uploads
    ├── proxy.ts                 # Next.js 16 Proxy (renamed Middleware): @supabase/ssr session refresh + auth gate
    ├── package.json             # web deps + scripts (next dev, next build)
    └── next.config.ts

(no other top-level infra — auth is a password gate in the web app; see below)
package.json                     # workspace root: thin delegating scripts (dev, dev:all, refdocs:*, …)
CLAUDE.md
```

The two apps share zero source code today. If we ever extract shared types (e.g. an API contract generated from the agent's tool schemas), it goes in a sibling `packages/` directory; we don't need it yet.

## Running it

Two services. Run both — backend changes hot-reload via Mastra file-watching, frontend changes HMR via Next.js (Turbopack). All commands run from the repo root; root scripts delegate via `npm --prefix apps/<app>`.

```bash
npm run install:all                         # installs root + apps/agent + apps/web
npm run dev:all                             # mastra (:4111) + next (:3000) — that's everything

# or run them separately:
npm run dev          # mastra only — also opens Mastra Studio at :4111
npm run dev:web      # next only

npm run fixtures:build   # regenerates test PDFs under apps/agent/fixtures/docs/
```

All persistent state lives in local files under `apps/agent/.data/` ("the DB is a file"):

| file | contents | owner |
| --- | --- | --- |
| `corpus.db` | reference corpus (ref_* tables, FTS5 + vectors) + forms catalog | `db/libsql.ts` |
| `app.db` | domain data (tax_facts, ai_decisions, filings, …) | `db/appDb.ts` |
| `mastra.db` | Mastra runtime (threads, messages, working memory) | `@mastra/libsql` |
| `documents/` | document blobs `{filingId}/{category}/{slug}-{ulid}.{ext}` | `db/blobStore.ts` |

Pin all four paths via env (`CORPUS_DB_PATH` / `APP_DB_PATH` / `MASTRA_DB_PATH` / `DOCUMENTS_PATH`) — module-relative defaults resolve differently inside Mastra's bundled output than in tsx scripts. There are **no external services**: no Docker, no Postgres, no Supabase.

**Auth (single-user):** identity = the instance. One `owner` row in `app.db` holds profile data (name/email) plus an scrypt password hash and the session-cookie HMAC secret — all created by the web app's first-run `/setup` screen. Login = one password → signed httpOnly cookie (`lib/localAuth.ts`, ~100 lines, node:crypto only). `proxy.ts` does an optimistic cookie-presence redirect; layouts/route handlers verify for real via `getOwnerSession()`.

**The browser never talks to the agent.** All agent calls (chat streaming, `/app/state`, filing lifecycle, thread history) go through the same-origin `/api/agent/[...path]` proxy — session-cookie authenticated, forwarded server-side to `AGENT_INTERNAL_URL` (default `http://127.0.0.1:4111`), streaming passed through. The agent itself has no user auth; `ownerMiddleware` resolves the instance owner from `app.db` for memory scoping, and an optional `AGENT_API_TOKEN` gates the port when it's reachable beyond localhost. Everything non-agent — activity, drafts, uploads, filings lists — is read from `app.db` directly: Server Components via `lib/serverDb.ts`, browser code via the `/api/*` Route Handlers (no realtime channel — client components poll on a short interval). With RLS gone, **every query scopes explicitly** by `userId`/`filingId` (`Scope` in `db/appDb.ts`), and routes gate with membership checks before touching another filing's data.

## First run

Delete `apps/agent/.data/` for a factory reset. On first visit, the web app redirects to `/setup` — create the owner account (name, email, password) — then start a filing from the home page. No seed scripts, no test users; the setup screen IS the seeding.

## Development workflow

We're building agent + UI together. When changes touch both, expect to:

1. **Edit code** (backend in `apps/agent/src/mastra/`, frontend in `apps/web/{app,components,lib}/`).
2. **Watch logs** for errors. Three places to look:
   - **Mastra log** — backend errors, agent traces, tool-call output. When Claude runs mastra in the background it writes to `/private/tmp/claude-501/.../tasks/<id>.output`; otherwise it's whatever terminal you started `npm run dev` in.
   - **Mastra Studio** at http://localhost:4111 — the **Observability** tab shows full agent traces (which tools fired, with what args, in what order). This is the right place to debug "why did Luca do X?".
   - **Browser console + Network panel** — frontend errors and HTTP failures (401s from a wrong passcode, 404s from a missing proxy entry, etc.).
3. **Verify the change in the browser** at http://localhost:3000. Sign in with the owner password (session cookie persists across reloads). To wipe state between test runs use **Delete filing** (avatar menu, top-right) and start a fresh filing from the home page. The activity rail and header counters refresh after each agent turn (plus a short client-side poll).

For backend-only changes you don't always need to open the browser — `curl` against `http://localhost:4111/app/state` (or `/api/agents/luca/stream`) with `Authorization: Bearer <DEMO_PASSCODE>` is faster.

### Claude verifies UI changes via claude-in-chrome

Claude has the `mcp__claude-in-chrome__*` toolset available. After any non-trivial UI change, use it to drive the browser yourself: navigate to `:3000`, log in, exercise the affected flow, read the console for errors, and report what you observed. This is faster and more reliable than asking Andrew to manually test every iteration. For multi-step interactions worth reviewing later, use `gif_creator` to record the run.

Limits worth remembering:
- These tools are deferred — load each one with `ToolSearch` (`select:mcp__claude-in-chrome__<name>`) before calling it.
- Avoid triggering `alert()` / `confirm()` / `prompt()` dialogs — they freeze the extension. The Delete-filing button uses `confirm()`; if you need to test it programmatically, dispatch the click in the codepath that bypasses the confirm or temporarily comment it out.
- If a browser tool errors twice in a row, stop and ask Andrew rather than retrying blindly.

### Resetting user data

Two paths:
- **UI: Delete filing** (avatar menu) → `DELETE /app/filings/:id` — removes the filing's blob directory, cascades every domain row, deletes the Mastra thread. Start a fresh filing from the home page afterwards.
- **API: `POST /app/session/reset`** → `resetCurrentUserData` in `apps/agent/src/mastra/db/resetUserData.ts` — wipes the user's rows but keeps the filing + memberships. No UI button anymore.

**Reference corpus and `apps/agent/forms/` always survive.** To rebuild the corpus, delete `.data/corpus.db` and run `npm run refdocs:sync`. To nuke everything, delete the `.data/` directory and re-run `npm run db:reset`.

## Mastra schema

The runtime store is `@mastra/libsql` (pinned; see `server/storage.ts` and `agents/luca.ts` — agents with `memory: new Memory({ storage })` create their own store instance against the same `mastra.db` file). Mastra runs its own idempotent `init()` on boot — a handful of local `CREATE TABLE IF NOT EXISTS` statements, cheap enough that the old `disableInit` + standalone-migration machinery is gone. On `@mastra/*` version bumps, the framework migrates its own schema; keep `mastra.db` separate from `app.db` so that can never touch user data.

## Data-model iteration: wipe + re-ingest, not migrations

While the data model is in flux, breaking schema changes are handled by **wiping and re-seeding**, not by migrations or backfill scripts: edit the `CREATE TABLE` statements in `db/appDb.ts` (or `db/libsql.ts` for the corpus), delete the affected `.data/*.db` file, and re-run `npm run db:seed` / `npm run refdocs:sync`. Delete-filing + fixture-driven re-ingest restores a known-good user state.

There is no migration system for the libsql files — dev/test data only. That changes when real users have data worth preserving (revisit in Phase 4 packaging).

## Form engine — the FormField model

Every output form (1040, 540, 8949, Schedule D, …) is a collection of typed **FormField**s. A FormField is the unified abstraction over every inputable value on the form — numeric lines, single-select checkboxes, text fields (name, address), boolean checkboxes, date fields. All share `BaseFormField` (`fieldId`, `label`, `category`, `valueType`, `result`).

**Two required properties every new field must declare:**

- **`category: Category`** — which Filing Status panel bucket the field rolls up into. One of `personal_info | filing_scope | income | deductions_credits | other`.
- **`valueType: FieldValueType`** — shape of the field's value. One of `numeric | single_select | text | boolean | date`.

TypeScript enforces both. Adding a field without declaring them is a compile error — the categorization layer (`forms/categorization/categorize.ts`) is automatically consistent because it reads `field.category` directly off each field.

**When adding a new form** (e.g. Schedule A): define line types extending `BaseFormField`, write the evaluator, register in `caseState.ts`'s form list, add a PDF renderer. TypeScript will fail to compile until every field has its `category` and `valueType`. There's no separate registry file to keep in sync.

**Header fields** (top-of-form personal info, filing-status checkboxes) are modeled as FormFields too — text/single-select kinds that derive from identity facts / scope decisions. They sit in the same `EvaluatedForm.fields` array as the numeric lines. PDF renderers continue to read raw facts directly; the header fields exist for the Filing Status panel rollup.

### Whole-dollar rounding convention — `Math.ceil`

Every tax-form line that expects a whole-dollar entry rounds **UP** to the next dollar via `Math.ceil`. Not `Math.round`, not truncation — always up.

Applies to:
- Worksheet inputs that arrive with floating-point precision (e.g. summed 1099-DIV box totals like $381.40)
- Percentage multiplications (e.g. 15% of $13,885 = $2,082.75 → $2,083)
- Any other "fill in the dollar amount" line on a form or worksheet

Why: the IRS instruction says "you may round off cents to whole dollars" without specifying direction. CPA software conventionally rounds up because that's conservative for the taxpayer (slight overpayment is fine, underpayment triggers penalties). Verified against an actual CPA-prepared 2024 return: their QDCG worksheet line 21 used `ceil(72,151 × 0.20) = 14,431` (not `round → 14,430`), and the cumulative ceiling rounding produced the exact $1 difference that confirmed the convention.

Implementation pattern (used in `src/mastra/engine/worksheets/qdcg.ts`):
```ts
const line1 = Math.ceil(inputs.taxableIncome);   // round inputs at entry
const line18 = Math.ceil(line17 * 0.15);          // round percentage lines
```

Tax-table lookups (`lookupTax`) already return whole dollars; rate-schedule lookups (`lookupRateSchedule`) return un-rounded values, and the caller (typically a worksheet) is responsible for ceiling at the next whole-dollar boundary.

Don't reach for `Math.round` on tax-form money. Default to `Math.ceil` and document any exception inline.

## Vercel logs (production debugging)

Production runtime logs for the agent come through `vercel logs`, but with gotchas:

- **Run from `apps/agent/`** — the linked project's directory. From the repo root, the CLI uses the wheel-of-finances project context and returns nothing for the agent. `apps/agent/.vercel/project.json` (gitignored) is what scopes the call.
- **`/health` bypasses user middleware.** Mastra special-cases its framework routes; a `/health` hit doesn't fire `server.middleware`, so it won't show your `console.log` lines. Test logging via `/api/*` or `/app/*` instead.
- **We don't use Mastra's `PinoLogger`** — its default destination is async-buffered and gets truncated on Vercel function exit, swallowing every log line on requests that error. We ship `ConsoleLogger` (`apps/agent/src/mastra/server/consoleLogger.ts`) instead — a ~70-line `MastraLogger` subclass that writes single-line JSON via `console.{log,warn,error}`. `vercel logs --json` parses each line into its structured fields. Use `mastra.getLogger()` (or `logger.error("msg", { err })`) anywhere new error paths land; no need for ad-hoc `console.log`.
- **Useful flags:** `--since 30m --limit 30 --expand` (historical), `--follow` (live tail), `--json` (richer per-request record incl. `responseStatusCode`, `cache`, structured `logs` array). No duration field — log timings yourself in middleware if needed.
- **Build logs (separate from runtime):** `vercel inspect <deployment-url> --logs`.

## Design principles

- **Never invent a number.** If the taxpayer isn't sure, the agent records an open question, not a guess. This is enforced in the system prompt and should be enforced in prompt tests once we have them.
- **Every fact has a citation.** The `source_note` field is required — document source, statement line number, or "verbal, date".
- **Document minimalism — only ask for load-bearing forms.** Getting a form is expensive user labor (dig through email, HR portal, physical mail). The default is verbal confirmation; we escalate to "please upload X" only when (a) the form is required to compute or file the return, or (b) a fact on the form can't be reliably obtained another way. Example: don't ask for Form 1095-C if the only fact we need is "had coverage all year" — a yes/no scoping question gets it faster. Example: W-2 box 12 code D already proves 401(k) contribution, so we don't also ask for Form 5498.
- **Bottom-up derivation, not top-down guessing.** The case engine computes state (draft 1040, scoping decisions, open asks) from facts via a graph of typed pure-function derivations. Luca *reads* the computed state to decide what to ask next; he doesn't invent scope or asks on his own.
- **Reactive, not batch.** Every fact write triggers downstream re-derivation. At any turn, the draft 1040, open-asks list, and decisions reflect everything known so far. Observable at every step.
- **Stage boundaries are hard.** Stage 1 (Gatherer) doesn't compute tax owed, suggest strategies, or fill forms. Cross-stage leakage is a bug.
- **Human in the loop.** Stage 3 requires CPA sign-off before anything ships. The preparer will probably use Opus for accuracy over cost.
- **Suggest the manual edit when it's faster.** If a task can be done in 10 seconds by Andrew opening a file and changing one line — `.env`, a constant, a feature-flag default — say so up-front instead of writing scripts, chained env loaders, or dotenv-cli wrappers to do it programmatically. Reach for tooling only when the change is repeated, conditional, or part of an automated flow.

## Facts vs. AI decisions (two-phase reasoning)

The system separates two kinds of data:

- **Tax facts** (`tax_facts` table) — things the taxpayer stated directly. Raw, verbatim. Written by `record-tax-fact` / `ingest-w2-structured`.
- **AI decisions** (`ai_decisions` table) — judgment calls the agent made when facts were ambiguous or underdetermined. Every decision carries: `decisionKey`, `decision`, `rationale` (the agent's plain-English "why"), `supportingFactKeys[]` (which facts it used), `confidence` (low/medium/high), and `dissentingConsiderations` (what could make it wrong). Written by `record-ai-decision`.

Decisions flow back into the case engine: a decision with key `decisions.ca_residency` becomes a fact-like input that downstream derivations can consume. This means "is this person a full-year CA resident?" can be the output of AI reasoning, and the CA 540 scoping derivation reads it like any other fact.

**Two-phase pattern — decide and ground synchronously.** Every `record-ai-decision` call now triggers Nynaeve, who reviews the decision against the supporting facts and the ingested IRS reference corpus, then writes one of four verdicts back to the row: `accurate` / `inaccurate` / `ungroundable` / `review_failed`. `authority_citations_json` populates with `{blockId, quote?}[]` when the verdict is `accurate`. Luca sees the verdict in the tool response and can re-ask the user if `inaccurate`. See the "Reference-document RAG" section for the corpus and retrieval pipeline.

## Tax facts schema

`tax_facts` rows are keyed by `(taxpayer_id, year, category, fact_key)` in spirit — we don't enforce uniqueness yet because we want an append-only audit log of what was told to us and when.

Categories (see `apps/agent/src/mastra/tools/taxFacts.ts` for the enum):
`identity`, `filing_status`, `dependents`, `wages`, `self_employment`, `k1`, `investment_income`, `capital_gains`, `rental`, `retirement`, `hsa`, `charitable`, `mortgage`, `state_local_tax`, `medical`, `education`, `estimated_payments`, `crypto`, `foreign`, `trust_estate`, `other`.

Add categories as the domain grows. Prefer splitting over lumping (it's easier to roll up later than to untangle a bucket).

## Reference-document RAG and the grounding workflow (Nynaeve)

### Where the corpus lives

The reference corpus (IRS pubs/instructions, FTB booklets, etc.) lives in **`.data/corpus.db`** — a local libsql/SQLite file, separate from user data (`app.db`) because it's shared, read-mostly reference material that will ship prebuilt as a release asset (Phase 4). Client + schema live in `apps/agent/src/mastra/db/libsql.ts`; the same file also holds the forms catalog (`forms` / `form_fields`, written by the forms-ingest pipeline, dormant at runtime).

### Corpus shape (libsql)

```
ref_documents → ref_pages    (page char-ranges into canonical_text)
              → ref_sections (heading hierarchy with stable slugs)
              → ref_blocks   (paragraph/list_item/etc — the citable unit)
                  + embedding          — F32_BLOB(1024) (libsql native, voyage-law-2)
ref_blocks_fts                (FTS5 mirror of coalesce(contextualized_text, text),
                               porter stemming; populated at write time)
```

Stable IDs — used everywhere as citations:
- `irs-1040-inst-2025` (doc)
- `irs-1040-inst-2025::sec::single` (section)
- `irs-1040-inst-2025::p13::b00013` (block)

Canonical text lives on disk next to its source PDF: `apps/agent/forms/<jurisdiction>/<short>/instructions.canonical.txt`. DB stores char offsets pointing into it. Source-of-truth is the canonical file; everything else is a derivation.

### Adding or updating a reference document

Each form's instructions live at `apps/agent/forms/<jurisdiction>/<short>/instructions.pdf` with a sibling `instructions.meta.json` carrying the doc metadata:

```json
{
  "docId": "irs-1040-inst-2025",
  "title": "Instructions for Form 1040 (2025)",
  "publisher": "IRS",
  "taxYear": 2025,
  "sourceUrl": "https://www.irs.gov/pub/irs-pdf/i1040gi.pdf"
}
```

Operator flow:

```bash
# 1. Drop new/updated instructions.pdf + instructions.meta.json into the form's folder
#    (apps/agent/forms/<jurisdiction>/<short>/)
# 2. See what's drifted vs the corpus DB:
npm run refdocs:status           # diff: present / missing / sha-drift / extra / unconfigured
npm run refdocs:status -- --strict  # exit non-zero on any drift (for CI/pre-push later)

# 3. Sync changes into corpus.db (idempotent, sha-skips already-ingested docs):
npm run refdocs:sync             # ~$0.50 + ~5 min per new/changed doc

# 4. If a previous sync wrote rows but failed at the embeddings step,
#    re-embed without re-paying for Haiku contextualization:
npm run refdocs:reembed
```

Cost: ~$0.50 Haiku contextualization + ~$0.02 Voyage embeddings + ~$0 rerank per doc. Sha-skip means re-runs are free.

### Ingest pipeline

```
PDF → shaOfFile (compare to ref_documents.sha256 — skip if match)
    → unpdf extractText (per-page text)
    → parseDoc (heading detection → Document/Section/Block tree, stable IDs)
    → contextualize (Haiku per block, section-scoped prompt cache)
    → writeDocument (insert rows, embedding=NULL)
    → embed (voyage-law-2, batched by 128 inputs OR 120k tokens)
    → setBlockEmbeddings (per-row UPDATE, concurrency 10)
```

We write the rows BEFORE embedding so a Voyage failure doesn't waste the ~$0.50 of Haiku contextualization — that's what `refdocs:reembed` recovers from. `block_text_sha1` column is in place for future "skip re-summarize when text unchanged" optimization (not yet wired).

### Retrieval — `search-ref-docs` tool

Single entry point. `callMatch` in `db/refDocs.ts` (the TS port of the old Postgres `match_ref_blocks` function) runs two legs and merges in JS: top-N from the FTS5 leg (`MATCH` + bm25, negated to higher-is-better) unioned with top-N from the vector leg (brute-force `vector_distance_cos` — exact and fast at low-thousands of blocks; no ANN index on purpose). The JS layer reranks via Voyage rerank-2.5.

```
query
 → callMatch ─┬─ FTS5 top-50 (bm25 over ref_blocks_fts)          ┐
              └─ vector top-50 (vector_distance_cos over blocks) ┘ → dedupe → rerank-2.5 → top-K
```

Falls back gracefully:
- Voyage key absent → FTS-only (vector leg skipped entirely)
- Rerank API fails → return merged candidates ordered by best-of-leg

`mode` parameter (`auto` | `fts` | `vector` | `hybrid`) lets evals A/B specific legs.

### The reviewDecision workflow

`apps/agent/src/mastra/workflows/reviewDecision.ts` — synchronously called from `record-ai-decision` after the decision row is written. Loads the decision + supporting facts, invokes Nynaeve with `maxSteps: 10` and a Zod-typed structured output schema, persists `verdict` + `verdict_reason` + `authority_citations_json`. Logs every review with the `[nynaeve-review]` prefix in dev-server stdout — grep for it.

Nynaeve's prompt is in `apps/agent/src/mastra/agents/nynaeve.instructions.ts`. She has `search-ref-docs` and `cite-ref-docs` as tools, with a hard 3-search budget. Hard rule: never cite a `blockId` that didn't come back from one of those tools in the same review.

### Inspection scripts

All scripts live under `apps/agent/scripts/` and run via `npm run <name>` from the repo root (which delegates into the agent's `package.json`).

| script | use |
|---|---|
| `refdocsStatus.ts` | diff repo PDFs vs corpus.db (npm: `refdocs:status`) |
| `refdocsSync.ts` | idempotent corpus sync (npm: `refdocs:sync`) |
| `refdocsReembed.ts` | re-embed NULL-embedding blocks (npm: `refdocs:reembed`) |
| `ingestRefDoc.ts` | manual single-doc ingest (npm: `refdocs:ingest`) |
| `checkCorpus.ts` | row counts + per-doc embedding coverage |
| `searchRefDocs.ts` | invoke the production search tool with a query |
| `compareRetrieval.ts` | same query through FTS / vector / hybrid+rerank |
| `smokeReview.ts` | three end-to-end review scenarios (npm: `smoke:review`) |
| `inspectLastReview.ts` | dump most recent review-decision workflow run + trace |
| `renderScenario.ts` | render every form in a scenario to PDF for spot-checking |

### Lessons from this build (read before changing the pipeline)

- **Mastra `maxSteps` defaults to 5 — too low for "ungroundable" verdicts.** Nynaeve burns steps chasing publications the corpus references but doesn't include (e.g. FTB Pub 1031). When she hits the limit mid-tool-call, no final summary is produced and the structuring agent has nothing to convert → `review_failed` with "no structured output". Bump to 10 in `reviewDecision.ts` AND give the agent a hard search budget in the prompt.
- **Mastra structured-output with tools needs `structuredOutput.model` (separate structuring agent) OR `jsonPromptInjection: true`.** We use the former — Nynaeve does tool calls naturally, then a second Haiku pass extracts structured output from her final text. Direct JSON injection conflicts with critic-style prompts where the agent reasons in prose.
- **Supabase `upsert` validates NOT NULL columns on the INSERT side, even when conflict triggers UPDATE.** `setBlockEmbeddings` originally tried to upsert `(block_id, embedding)` only — PostgREST rejected because `text`, `doc_id`, etc. are NOT NULL. Fix: per-row `UPDATE … WHERE block_id = …` with concurrency 10. RPC bulk-update is the next optimization if 383 rows × ~50ms ever becomes a bottleneck.
- **Wrap Supabase errors as `Error` instances at the call site.** They're plain `{ message, code, details, hint }` objects, so `String(err)` becomes `[object Object]` in any try/catch. `assertOk()` in `apps/agent/src/mastra/db/refDocs.ts` does this — copy the pattern when adding new query helpers.
- **The cookbook's "send the whole document" doesn't fit big tax docs.** 1040 instructions alone are ~211k tokens — over Haiku's 200k. We use **section-scoped context** for contextual summarization: each block is summarized with its section text as the cached prefix. Same caching benefit (cache hits across blocks within a section), no doc-size ceiling.
- **Voyage has TWO per-batch limits: 128 inputs OR 120k tokens.** Tokens hit first for our contextualized text. `batchByLimits()` in `apps/agent/src/refdocs/voyage.ts` respects both. Token estimator: `chars / 2.5` is the conservative ratio for our Markdown-formatted text (chars/3.5 underestimates and overflows).
- **pgvector embedding literals serialize as strings, not arrays.** `vectorLiteral([1,2,3])` returns `"[1,2,3]"` — pass that as the column value. Passing a JS array silently fails or coerces. The `vector(1024)` column type must match the embedding model's dimensions exactly (voyage-law-2 = 1024).
- **Diagnose retrieval failures bottom-up.** Order: parser → FTS index → embeddings → reranker → agent prompt. Don't blame the corpus first. Our headline parsing failure was attributing the `§ Single` block to `(Preamble)`, not a corpus or retrieval gap. Verify section attribution by querying `ref_blocks` directly before tuning retrieval.
- **Heading detection needs both regex and named prose.** `Line Nx`, `Part N`, `Schedule N` come from regex. Standalone Title Case headings like `Single`, `Married Filing Jointly`, `Head of Household` need an explicit `KNOWN_PROSE_HEADINGS` set in `apps/agent/src/refdocs/parse.ts`. Title-case continuation rule absorbs multi-line headings (`Qualifying Surviving` + `Spouse`).
- **One-off smoke tests miss "fixed A but broke B" patterns.** A 3-case smoke gave us false confidence twice during this build. Phase 6 of the original plan (a real Mastra eval dataset with scorers) is the next thing to build before any further prompt/retrieval changes.
- **Nynaeve uses Haiku because the task is narrow.** Read decision + facts + tool results, return one of four verdicts with citations. If verdict-quality drops on harder cases, swap to Sonnet — one-line change in `apps/agent/src/mastra/agents/nynaeve.ts`. Don't reach for it preemptively.
- **`structuredOutput.errorStrategy: "strict"` is right for production but loud during prompt iteration.** Catches malformed model output explicitly via the existing try/catch → `review_failed` verdict, so failures surface in the DB rather than being papered over.
- **Pre-retrieval and curated topic indexes were dead ends for this domain.** We considered both; agent-with-good-tool wins on simplicity once the retrieval pipeline is strong. Resist re-introducing pre-retrieval plumbing unless evals show the agent genuinely can't formulate queries — and even then, fix the agent prompt first.

## Related project — lessons carried forward

This project is a deliberate application of lessons learned from **Mr. BigBadgeGuy** (BBG), a Mastra-based agent at `/Users/andrewcole/playground/bigbadgeguy-agent`. BBG memory lives at `/Users/andrewcole/.claude/projects/-Users-andrewcole-playground-bigbadgeguy/memory/` — read `MEMORY.md` there for the full index. When a second Claude Code session in this folder needs context, point it at that directory.

Lessons worth bringing forward:

- **Mastra tool `execute` signature**: receives the Zod-validated input as the first argument (not a wrapped `{ context }` object in current versions). When calling a tool outside of an agent, use `(tool as any).execute(input)`.
- **Agent `Memory` + per-item loops is a trap.** BBG's Twitter poller used `agent.generate()` inside a `for` loop over mentions; memory carried context between iterations and polluted replies. For multi-item batch work, either make each iteration stateless or use separate threads.
- **Advance dedup markers before processing, not after.** BBG was replying to the same mention multiple times because the "last processed" marker only advanced after the loop completed successfully. Set it first so a crash can't re-process.
- **Research before building integrations.** For any new third-party API (IRS, state, Plaid, document OCR), do a research pass first, then build. Coding from memory against unfamiliar APIs wastes cycles. This is also saved in BBG's memory.
- **`mastra dev` doesn't auto-load `.env`.** The `dev` script in `apps/agent/package.json` passes `--env .env.development` explicitly for a reason.
- **Vercel Cron is the right primitive for scheduled work.** A `crons` entry in `vercel.json` triggers a function via HTTP at the given schedule; that function reads/writes Postgres like any other invocation, no shared-state problem. Don't reach for `setInterval` (won't survive function freeze on serverless) or external schedulers. Becomes relevant when we add Nynaeve-as-background-worker or document-ingestion pollers.

## Finding Mastra docs

Mastra ships its reference docs *inside* the installed package — always check there before guessing from memory or going to the web:

- **Reference docs (Markdown)**: `node_modules/@mastra/core/dist/docs/references/`
  - `docs-*.md` — topical guides (e.g. `docs-studio-observability.md`, `docs-memory-storage.md`)
  - `reference-*.md` — per-API/class reference (e.g. `reference-logging-pino-logger.md`, `reference-storage-libsql.md`)
  - `SKILL.md` — canonical quick-start and core concepts
- **Type definitions**: `node_modules/@mastra/core/dist/**/*.d.ts` — authoritative when docs are silent (e.g. finding what `InMemoryStore`, `MastraCompositeStore`, `ObservabilityStorage` actually expose)
- **Sibling packages**: `node_modules/@mastra/<name>/dist/` — loggers, libsql, observability, memory, server, etc. all follow the same layout

Rule of thumb: grep the bundled docs first (`Grep pattern path=node_modules/@mastra/core/dist/docs`), then fall back to `.d.ts` files, then to `mastra.ai` docs online. The bundled copy is pinned to the installed version, so it can't drift from what's actually running.

## What belongs in CLAUDE.md vs memory

- Architecture, file layout, commands, design principles → **this file** (checked in, visible to anyone).
- User preferences, cross-project learnings, ongoing context → **`~/.claude/projects/.../memory/`** (local, persists across sessions).

If you're a fresh Claude Code session starting in this folder: read this file, then read the BBG memory dir for broader context on how Andrew builds agents.

## Things explicitly out of scope (for now)

- Automatic document OCR / parsing (we'll add it later — probably a separate service; for MVP, ingestion takes structured payloads)
- Direct IRS filing (human-in-the-loop CPA signs off first)
- Multi-tenant auth / client portal (single-user for prototyping)
- Pricing, payments, scheduling (Stage 1 only cares about extracting facts)
- Anything outside the Alex-simple scenario (single CA filer, one W-2, no deps, standard deduction). When the user's situation goes outside, Luca responds "Oh, we don't handle that scenario yet" rather than inventing behavior.
