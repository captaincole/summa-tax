# Project Wheel of Time — Claude Development Guide

## What this is

**Wheel of Time** (formerly "Merrilin") is an AI CPA platform for high-net-worth individuals (HNWIs). Target user has W-2 income of $400k+/yr and $2–5M in investable assets, often with RSUs, K-1s, rental property, multi-state or foreign exposure, crypto, and meaningful charitable giving.

Agents on the platform are named after characters from the *Wheel of Time* novels:

- **Thom Merrilin** — the conversational front-desk agent; guides the user through the tax-prep flow, orchestrates workflows, narrates progress. First agent built.
- **Nynaeve al'Meara** — critic agent; reviews every `record-ai-decision` synchronously and grounds it (or flags it) against the IRS reference corpus. Runs on Haiku 4.5. See "Reference-document RAG" section.
- Future specialist agents get additional WoT character names as they land.

Note: the Unix working directory is still `project-merrilin` (the product was originally called Merrilin; it now lives on only as Thom's surname). Internal names / IDs / docs use "wheel-of-time" or "Wheel of Time".

The end goal is a three-stage workflow:

1. **Gatherer** (Stage 1, where we are now) — Thom Merrilin runs conversational intake that captures structured tax facts with citations and produces a live-updating case state (draft 1040, open asks, decisions).
2. **Summarizer** (Stage 2, not built yet) — turns gathered facts into a human-reviewable tax summary / organizer.
3. **Preparer** (Stage 3, not built yet) — fills out the actual forms (1040 + schedules, state returns). Human-in-the-loop is mandatory; a CPA signs off.

Everything routes through a SQLite-backed `tax_facts` table where each row has a `source_note` citing where the value came from. No fact exists without a citation.

## Repo structure

This is a monorepo. Two independent deploy units, each with its own `package.json` and lockfile:

```
apps/
├── agent/                       # Mastra backend → deployed to Render
│   ├── src/mastra/              # agent code (Thom, Nynaeve, tools, db, server, workflows)
│   ├── src/refdocs/             # reference-corpus ingest pipeline (parse, contextualize, embed)
│   ├── fixtures/                # canonical test scenarios + PDF render pipeline
│   ├── scripts/                 # operator scripts (refdocs:*, db:reset, smoke:review, etc.)
│   ├── ref/                     # blank PDF templates the form engine fills (1040, 8949, …)
│   ├── reference-docs/          # IRS / FTB PDFs ingested into the Supabase corpus
│   ├── supabase/                # corpus migration history
│   ├── package.json             # agent deps + scripts (mastra dev, fixtures:build, refdocs:*)
│   └── tsconfig.json
└── web/                         # React + Vite frontend → deployed to Vercel
    ├── src/                     # Layout, routes, lib (api, mastraClient, auth)
    ├── package.json             # web deps + scripts (vite, vite build)
    └── vite.config.ts

package.json                     # workspace root: thin delegating scripts (dev, dev:all, db:reset, …)
render.yaml                      # Render blueprint for the agent (rootDir: apps/agent)
CLAUDE.md
```

The two apps share zero source code today. If we ever extract shared types (e.g. an API contract generated from the agent's tool schemas), it goes in a sibling `packages/` directory; we don't need it yet.

The case engine (derivation graph → live case state) and MVP artifact library are next to build.

## Running it

Two services. Run both — backend changes hot-reload via Mastra file-watching, frontend changes HMR via Vite. All commands run from the repo root; root scripts delegate via `npm --prefix apps/<app>`.

```bash
npm run install:all                         # installs root + apps/agent + apps/web
cp apps/agent/.env.example apps/agent/.env.development
# edit apps/agent/.env.development with ANTHROPIC_API_KEY + DEMO_PASSCODE
npm run dev:all                             # mastra (:4111) + vite (:5173)

# or run them separately:
npm run dev          # mastra only — also opens Mastra Studio at :4111
npm run dev:web      # vite only

npm run fixtures:build   # regenerates test PDFs under apps/agent/fixtures/docs/
```

The SQLite database file is created on first run at `apps/agent/wheel-of-time.db` (gitignored; relative to where `mastra dev` runs). In dev the frontend reaches Mastra via Vite's proxy: `/api`, `/app`, and `/drafts` all forward to `:4111`. In prod the frontend is on Vercel and calls Mastra via `VITE_API_URL` set at build time.

## Development workflow

We're building agent + UI together. When changes touch both, expect to:

1. **Edit code** (backend in `apps/agent/src/mastra/`, frontend in `apps/web/src/`).
2. **Watch logs** for errors. Three places to look:
   - **Mastra log** — backend errors, agent traces, tool-call output. When Claude runs mastra in the background it writes to `/private/tmp/claude-501/.../tasks/<id>.output`; otherwise it's whatever terminal you started `npm run dev` in.
   - **Mastra Studio** at http://localhost:4111 — the **Observability** tab shows full agent traces (which tools fired, with what args, in what order). This is the right place to debug "why did Thom do X?".
   - **Browser console + Network panel** — frontend errors and HTTP failures (401s from a wrong passcode, 404s from a missing proxy entry, etc.).
3. **Verify the change in the browser** at http://localhost:5173. Login passcode is whatever's in `.env.development` as `DEMO_PASSCODE`. Hit **Reset** in the chat header to wipe state between test runs. The right rail (when we add it) and the header counters refresh after each agent turn.

For backend-only changes you don't always need to open the browser — `curl` against `http://localhost:4111/app/state` (or `/api/agents/thom/stream`) with `Authorization: Bearer <DEMO_PASSCODE>` is faster.

### Claude verifies UI changes via claude-in-chrome

Claude has the `mcp__claude-in-chrome__*` toolset available. After any non-trivial UI change, use it to drive the browser yourself: navigate to `:5173`, log in, exercise the affected flow, read the console for errors, and report what you observed. This is faster and more reliable than asking Andrew to manually test every iteration. For multi-step interactions worth reviewing later, use `gif_creator` to record the run.

Limits worth remembering:
- These tools are deferred — load each one with `ToolSearch` (`select:mcp__claude-in-chrome__<name>`) before calling it.
- Avoid triggering `alert()` / `confirm()` / `prompt()` dialogs — they freeze the extension. Our Reset button uses `confirm()`; if you need to test it programmatically, dispatch the click in the codepath that bypasses the confirm or temporarily comment it out.
- If a browser tool errors twice in a row, stop and ask Andrew rather than retrying blindly.

### Resetting user data

```bash
npm run db:reset                          # manual wipe, run between test sessions
RESET_USER_DATA_ON_START=1 npm run dev    # wipe on boot (ephemeral deploys, CI)
```

**What gets wiped:** every libsql table whose name does NOT start with `ref_` or `sqlite_`. That includes all Mastra runtime tables (`mastra_messages`, `mastra_threads`, traces, scorers, workflow snapshots…) plus ours (`tax_facts`, `open_questions`, `ai_decisions`). Mastra and our own db modules recreate their schemas automatically on next use. Generated per-user artifacts on disk (currently `apps/agent/src/mastra/public/drafts/*.pdf`) are deleted too.

**What survives:** any `ref_*` libsql table, anything in Supabase, and any file under `apps/agent/ref/`. Convention:

- **Supabase:** the reference corpus (`ref_documents`, `ref_pages`, `ref_sections`, `ref_blocks`) lives entirely on Supabase, so `db:reset` (which only touches libsql) cannot affect it. To wipe corpus state, `delete from ref_documents` in the Supabase SQL editor and `npm run refdocs:sync` to repopulate.
- **libsql `ref_*` tables:** the prefix is reserved for future libsql-side reference data (e.g. published bracket tables that are too small to warrant Supabase). None today; the convention is preserved for when we add some.
- **Filesystem:** put reference assets under `apps/agent/ref/` (e.g. `apps/agent/ref/forms/f1040-2025.pdf`). Put generated per-user artifacts under `apps/agent/src/mastra/public/<dir>/` (e.g. `apps/agent/src/mastra/public/drafts/`). The reset wipes the generated dirs; `apps/agent/ref/` and `apps/agent/reference-docs/` are untouched.

When you add a new generated-artifact directory, extend `GENERATED_DIRS` in `apps/agent/src/mastra/fs/cleanGeneratedFiles.ts`.

The shared reset helpers are `apps/agent/src/mastra/db/resetUserData.ts` (tables) and `apps/agent/src/mastra/fs/cleanGeneratedFiles.ts` (files); the CLI entry is `apps/agent/scripts/resetUserData.ts`.

## Design principles

- **Never invent a number.** If the taxpayer isn't sure, the agent records an open question, not a guess. This is enforced in the system prompt and should be enforced in prompt tests once we have them.
- **Every fact has a citation.** The `source_note` field is required — document source, statement line number, or "verbal, date".
- **Document minimalism — only ask for load-bearing forms.** Getting a form is expensive user labor (dig through email, HR portal, physical mail). The default is verbal confirmation; we escalate to "please upload X" only when (a) the form is required to compute or file the return, or (b) a fact on the form can't be reliably obtained another way. Example: don't ask for Form 1095-C if the only fact we need is "had coverage all year" — a yes/no scoping question gets it faster. Example: W-2 box 12 code D already proves 401(k) contribution, so we don't also ask for Form 5498.
- **Bottom-up derivation, not top-down guessing.** The case engine computes state (draft 1040, scoping decisions, open asks) from facts via a graph of typed pure-function derivations. Thom *reads* the computed state to decide what to ask next; he doesn't invent scope or asks on his own.
- **Reactive, not batch.** Every fact write triggers downstream re-derivation. At any turn, the draft 1040, open-asks list, and decisions reflect everything known so far. Observable at every step.
- **Stage boundaries are hard.** Stage 1 (Gatherer) doesn't compute tax owed, suggest strategies, or fill forms. Cross-stage leakage is a bug.
- **Human in the loop.** Stage 3 requires CPA sign-off before anything ships. The preparer will probably use Opus for accuracy over cost.
- **Suggest the manual edit when it's faster.** If a task can be done in 10 seconds by Andrew opening a file and changing one line — `.env`, a constant, a feature-flag default — say so up-front instead of writing scripts, chained env loaders, or dotenv-cli wrappers to do it programmatically. Reach for tooling only when the change is repeated, conditional, or part of an automated flow.

## Facts vs. AI decisions (two-phase reasoning)

The system separates two kinds of data:

- **Tax facts** (`tax_facts` table) — things the taxpayer stated directly. Raw, verbatim. Written by `record-tax-fact` / `ingest-w2-structured`.
- **AI decisions** (`ai_decisions` table) — judgment calls the agent made when facts were ambiguous or underdetermined. Every decision carries: `decisionKey`, `decision`, `rationale` (the agent's plain-English "why"), `supportingFactKeys[]` (which facts it used), `confidence` (low/medium/high), and `dissentingConsiderations` (what could make it wrong). Written by `record-ai-decision`.

Decisions flow back into the case engine: a decision with key `decisions.ca_residency` becomes a fact-like input that downstream derivations can consume. This means "is this person a full-year CA resident?" can be the output of AI reasoning, and the CA 540 scoping derivation reads it like any other fact.

**Two-phase pattern — decide and ground synchronously.** Every `record-ai-decision` call now triggers Nynaeve, who reviews the decision against the supporting facts and the ingested IRS reference corpus, then writes one of four verdicts back to the row: `accurate` / `inaccurate` / `ungroundable` / `review_failed`. `authority_citations_json` populates with `{blockId, quote?}[]` when the verdict is `accurate`. Thom sees the verdict in the tool response and can re-ask the user if `inaccurate`. See the "Reference-document RAG" section for the corpus and retrieval pipeline.

## Tax facts schema

`tax_facts` rows are keyed by `(taxpayer_id, year, category, fact_key)` in spirit — we don't enforce uniqueness yet because we want an append-only audit log of what was told to us and when.

Categories (see `apps/agent/src/mastra/tools/taxFacts.ts` for the enum):
`identity`, `filing_status`, `dependents`, `wages`, `self_employment`, `k1`, `investment_income`, `capital_gains`, `rental`, `retirement`, `hsa`, `charitable`, `mortgage`, `state_local_tax`, `medical`, `education`, `estimated_payments`, `crypto`, `foreign`, `trust_estate`, `other`.

Add categories as the domain grows. Prefer splitting over lumping (it's easier to roll up later than to untangle a bucket).

## Reference-document RAG and the grounding workflow (Nynaeve)

### Where the corpus lives

The reference corpus (IRS pubs/instructions, FTB booklets, etc.) lives in **Supabase** — separate from user data, which is on libsql. The agent server reads via `@supabase/supabase-js` using a service-role secret. Migration history lives in `apps/agent/supabase/migrations/`.

Why split storage: the corpus is shared, read-mostly, and grows substantially as we cover more scenarios. User data is per-tenant and will eventually move to Supabase too (with RLS) — that's a separate phase.

Required env vars (already wired into `render.yaml`):
- `SUPABASE_URL` — project URL (https://<ref>.supabase.co)
- `SUPABASE_SECRET_KEY` — `sb_secret_…` service-role key. Bypasses RLS; never expose to the browser.

### Corpus shape (Postgres)

```
ref_documents → ref_pages    (page char-ranges into canonical_text)
              → ref_sections (heading hierarchy with stable slugs)
              → ref_blocks   (paragraph/list_item/etc — the citable unit)
                  + fts                  — generated tsvector column (English)
                  + idx_ref_blocks_fts   — GIN index over fts
                  + embedding            — vector(1024) (pgvector, voyage-law-2)
                  + idx_ref_blocks_embedding — HNSW cosine
```

Stable IDs — used everywhere as citations:
- `irs-1040-inst-2025` (doc)
- `irs-1040-inst-2025::sec::single` (section)
- `irs-1040-inst-2025::p13::b00013` (block)

Canonical text lives on disk at `apps/agent/reference-docs/extracted/<doc-id>.canonical.txt`; DB stores char offsets pointing into it. Source-of-truth is the canonical file; everything else is a derivation.

### Adding or updating a reference document

The PDFs in `apps/agent/reference-docs/` are the manifest. Each PDF has a sibling `<basename>.meta.json` with the doc metadata:

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
# 1. Drop new/updated PDF + sidecar into apps/agent/reference-docs/
# 2. See what's drifted vs Supabase:
npm run refdocs:status           # diff: present / missing / sha-drift / extra / unconfigured
npm run refdocs:status -- --strict  # exit non-zero on any drift (for CI/pre-push later)

# 3. Sync changes to Supabase (idempotent, sha-skips already-ingested docs):
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

Single entry point. Calls the `match_ref_blocks(query_embedding, query_text, match_count, filter_doc_id)` Postgres function via `supabase.rpc()`. The function returns up to 2×N candidates: top-N from FTS leg (`websearch_to_tsquery` + `ts_rank_cd`) unioned with top-N from vector leg (`embedding <=> query`). The JS layer reranks via Voyage rerank-2.5.

```
query
 → match_ref_blocks RPC ─┬─ FTS top-50 (ts_rank_cd over fts)    ┐
                         └─ vector top-50 (cosine over embedding) ┘ → dedupe → rerank-2.5 → top-K
```

Falls back gracefully:
- Voyage key absent → FTS-only (vector leg passes `query_embedding=null`, RPC returns FTS only)
- Rerank API fails → return merged candidates ordered by best-of-leg

`mode` parameter (`auto` | `fts` | `vector` | `hybrid`) lets evals A/B specific legs.

### The reviewDecision workflow

`apps/agent/src/mastra/workflows/reviewDecision.ts` — synchronously called from `record-ai-decision` after the decision row is written. Loads the decision + supporting facts, invokes Nynaeve with `maxSteps: 10` and a Zod-typed structured output schema, persists `verdict` + `verdict_reason` + `authority_citations_json`. Logs every review with the `[nynaeve-review]` prefix in dev-server stdout — grep for it.

Nynaeve's prompt is in `apps/agent/src/mastra/agents/nynaeve.instructions.ts`. She has `search-ref-docs` and `cite-ref-docs` as tools, with a hard 3-search budget. Hard rule: never cite a `blockId` that didn't come back from one of those tools in the same review.

### Inspection scripts

All scripts live under `apps/agent/scripts/` and run via `npm run <name>` from the repo root (which delegates into the agent's `package.json`).

| script | use |
|---|---|
| `refdocsStatus.ts` | diff repo PDFs vs Supabase (npm: `refdocs:status`) |
| `refdocsSync.ts` | idempotent corpus sync (npm: `refdocs:sync`) |
| `refdocsReembed.ts` | re-embed NULL-embedding blocks (npm: `refdocs:reembed`) |
| `ingestRefDoc.ts` | manual single-doc ingest (npm: `refdocs:ingest`) |
| `checkCorpus.ts` | row counts + per-doc embedding coverage |
| `verifyRefDocs.ts` | round-trip + spot-citation checks |
| `inspectBlock.ts` | peek at one block's summary + raw text |
| `searchRefDocs.ts` | invoke the production search tool with a query |
| `compareRetrieval.ts` | same query through FTS / vector / hybrid+rerank |
| `smokeReview.ts` | three end-to-end review scenarios (npm: `smoke:review`) |
| `inspectDecisions.ts` | recent ai_decisions with verdicts + citations |

### Lessons from this build (read before changing the pipeline)

- **Mastra `maxSteps` defaults to 5 — too low for "ungroundable" verdicts.** Nynaeve burns steps chasing publications the corpus references but doesn't include (e.g. FTB Pub 1031). When she hits the limit mid-tool-call, no final summary is produced and the structuring agent has nothing to convert → `review_failed` with "no structured output". Bump to 10 in `reviewDecision.ts` AND give the agent a hard search budget in the prompt.
- **Mastra structured-output with tools needs `structuredOutput.model` (separate structuring agent) OR `jsonPromptInjection: true`.** We use the former — Nynaeve does tool calls naturally, then a second Haiku pass extracts structured output from her final text. Direct JSON injection conflicts with critic-style prompts where the agent reasons in prose.
- **Supabase `upsert` validates NOT NULL columns on the INSERT side, even when conflict triggers UPDATE.** `setBlockEmbeddings` originally tried to upsert `(block_id, embedding)` only — PostgREST rejected because `text`, `doc_id`, etc. are NOT NULL. Fix: per-row `UPDATE … WHERE block_id = …` with concurrency 10. RPC bulk-update is the next optimization if 383 rows × ~50ms ever becomes a bottleneck.
- **Wrap Supabase errors as `Error` instances at the call site.** They're plain `{ message, code, details, hint }` objects, so `String(err)` becomes `[object Object]` in any try/catch. `assertOk()` in `apps/agent/src/mastra/db/refDocs.ts` does this — copy the pattern when adding new query helpers.
- **The cookbook's "send the whole document" doesn't fit big tax docs.** 1040 instructions alone are ~211k tokens — over Haiku's 200k. We use **section-scoped context** for contextual summarization: each block is summarized with its section text as the cached prefix. Same caching benefit (cache hits across blocks within a section), no doc-size ceiling.
- **Voyage has TWO per-batch limits: 128 inputs OR 120k tokens.** Tokens hit first for our contextualized text. `batchByLimits()` in `apps/agent/src/refdocs/voyage.ts` respects both. Token estimator: `chars / 2.5` is the conservative ratio for our Markdown-formatted text (chars/3.5 underestimates and overflows).
- **pgvector embedding literals serialize as strings, not arrays.** `vectorLiteral([1,2,3])` returns `"[1,2,3]"` — pass that as the column value. Passing a JS array silently fails or coerces. The `vector(1024)` column type must match the embedding model's dimensions exactly (voyage-law-2 = 1024).
- **Diagnose retrieval failures bottom-up.** Order: parser → FTS index → embeddings → reranker → agent prompt. Don't blame the corpus first. Our headline parsing failure was attributing the `§ Single` block to `(Preamble)`, not a corpus or retrieval gap. Use `inspectBlock.ts` to verify section attribution before tuning retrieval.
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
- **In-process schedulers beat Render Cron for shared state.** Render Cron runs in a separate container without access to the main instance's disk/SQLite. For anything that needs to read/write the agent's DB, use a `setInterval` inside the main process. (Not relevant yet, but will be if we add document-ingestion pollers.)

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
- Anything outside the Alex-simple scenario (single CA filer, one W-2, no deps, standard deduction). When the user's situation goes outside, Thom responds "Oh, we don't handle that scenario yet" rather than inventing behavior.
