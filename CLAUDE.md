# Project Wheel of Time — Claude Development Guide

## What this is

**Wheel of Time** (formerly "Merrilin") is an AI CPA platform for high-net-worth individuals (HNWIs). Target user has W-2 income of $400k+/yr and $2–5M in investable assets, often with RSUs, K-1s, rental property, multi-state or foreign exposure, crypto, and meaningful charitable giving.

Agents on the platform are named after characters from the *Wheel of Time* novels:

- **Thom Merrilin** — the conversational front-desk agent; guides the user through the tax-prep flow, orchestrates workflows, narrates progress. First agent built.
- **Nynaeve** (future) — critic agent; reviews decisions, challenges positions, catches issues before a human CPA does.
- Future specialist agents get additional WoT character names as they land.

Note: the Unix working directory is still `project-merrilin` (the product was originally called Merrilin; it now lives on only as Thom's surname). Internal names / IDs / docs use "wheel-of-time" or "Wheel of Time".

The end goal is a three-stage workflow:

1. **Gatherer** (Stage 1, where we are now) — Thom Merrilin runs conversational intake that captures structured tax facts with citations and produces a live-updating case state (draft 1040, open asks, decisions).
2. **Summarizer** (Stage 2, not built yet) — turns gathered facts into a human-reviewable tax summary / organizer.
3. **Preparer** (Stage 3, not built yet) — fills out the actual forms (1040 + schedules, state returns). Human-in-the-loop is mandatory; a CPA signs off.

Everything routes through a SQLite-backed `tax_facts` table where each row has a `source_note` citing where the value came from. No fact exists without a citation.

## Current state (as of 2026-04-21)

Scaffolded:

```
src/mastra/
├── agents/
│   └── thom.ts             # Thom Merrilin — conversational front-desk agent
├── tools/
│   └── taxFacts.ts         # record-tax-fact, list-tax-facts, note-open-question, list-open-questions, resolve-open-question
├── db/
│   └── taxFacts.ts         # tax_facts + open_questions tables, CRUD
└── index.ts                # Mastra instance, storage, logger

fixtures/
├── scenarios/              # canonical test taxpayers (narrative .md + structured .ts per scenario)
│   ├── 01-base-case.md
│   ├── 01-base-case.ts
│   ├── 02-itemize-case.md
│   ├── 02-itemize-case.ts (not yet written)
│   └── README.md
├── pipeline/               # scenario spec → PDF rendering via pdf-lib
│   ├── render.ts           # CLI
│   ├── renderers/w2.ts
│   └── types.ts
└── docs/                   # rendered reference PDFs (committed)
    └── 01-alex-w2.pdf
```

The case engine (derivation graph → live case state) and MVP artifact library are next to build.

## Running it

Two services. Run both — backend changes hot-reload via Mastra file-watching, frontend changes HMR via Vite.

```bash
npm install
npm install --prefix web                 # frontend deps
cp .env.example .env.development
# edit .env.development with ANTHROPIC_API_KEY + DEMO_PASSCODE
npm run dev:all                          # mastra (:4111) + vite (:5173)

# or run them separately:
npm run dev          # mastra only — also opens Mastra Studio at :4111
npm run dev:web      # vite only

npm run fixtures:build   # regenerates test PDFs under fixtures/docs/
```

The SQLite database file is created on first run at `src/mastra/public/wheel-of-time.db` (gitignored; Mastra dev's public-assets dir). The frontend reaches Mastra via Vite proxy: `/api`, `/app`, and `/drafts` all forward to `:4111`.

## Development workflow

We're building agent + UI together. When changes touch both, expect to:

1. **Edit code** (backend in `src/mastra/`, frontend in `web/src/`).
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

**What gets wiped:** every table whose name does NOT start with `ref_` or `sqlite_`. That includes all Mastra runtime tables (`mastra_messages`, `mastra_threads`, traces, scorers, workflow snapshots…) plus ours (`tax_facts`, `open_questions`, `ai_decisions`). Mastra and our own db modules recreate their schemas automatically on next use. Generated per-user artifacts on disk (currently `src/mastra/public/drafts/*.pdf`) are deleted too.

**What survives:** any `ref_*` table and any file under `ref/`. Convention:

- **DB tables:** prefix with `ref_` to survive resets (curated reference data — tax authorities, regulation text, form metadata, published bracket tables). Any other prefix (or none, like `tax_facts`) → per-session user data, wiped.
- **Filesystem:** put reference assets under `ref/` at project root (e.g. `ref/forms/f1040-2025.pdf`). Put generated per-user artifacts under `src/mastra/public/<dir>/` (e.g. `src/mastra/public/drafts/`). The reset wipes the generated dirs; `ref/` is untouched.

When you add a new generated-artifact directory, extend `GENERATED_DIRS` in `src/mastra/fs/cleanGeneratedFiles.ts`.

The shared reset helpers are `src/mastra/db/resetUserData.ts` (tables) and `src/mastra/fs/cleanGeneratedFiles.ts` (files); the CLI entry is `scripts/resetUserData.ts`.

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

**Two-phase pattern — decide now, ground later.** Decisions currently carry a `rationale` but no formal citations to tax authorities (Treasury regs, IRS pubs, Rev. Ruls., case law). The `authority_citations` field exists on every row but is null for MVP. A future **grounding workflow** will run over each decision, retrieve relevant passages from a curated tax-authority corpus, and write the citations back. This split is deliberate: it lets us ship the reasoning loop today without blocking on corpus curation, and it gives CPAs a concrete "show me the authority" review step later.

## Tax facts schema

`tax_facts` rows are keyed by `(taxpayer_id, year, category, fact_key)` in spirit — we don't enforce uniqueness yet because we want an append-only audit log of what was told to us and when.

Categories (see `src/mastra/tools/taxFacts.ts` for the enum):
`identity`, `filing_status`, `dependents`, `wages`, `self_employment`, `k1`, `investment_income`, `capital_gains`, `rental`, `retirement`, `hsa`, `charitable`, `mortgage`, `state_local_tax`, `medical`, `education`, `estimated_payments`, `crypto`, `foreign`, `trust_estate`, `other`.

Add categories as the domain grows. Prefer splitting over lumping (it's easier to roll up later than to untangle a bucket).

## Related project — lessons carried forward

This project is a deliberate application of lessons learned from **Mr. BigBadgeGuy** (BBG), a Mastra-based agent at `/Users/andrewcole/playground/bigbadgeguy-agent`. BBG memory lives at `/Users/andrewcole/.claude/projects/-Users-andrewcole-playground-bigbadgeguy/memory/` — read `MEMORY.md` there for the full index. When a second Claude Code session in this folder needs context, point it at that directory.

Lessons worth bringing forward:

- **Mastra tool `execute` signature**: receives the Zod-validated input as the first argument (not a wrapped `{ context }` object in current versions). When calling a tool outside of an agent, use `(tool as any).execute(input)`.
- **Agent `Memory` + per-item loops is a trap.** BBG's Twitter poller used `agent.generate()` inside a `for` loop over mentions; memory carried context between iterations and polluted replies. For multi-item batch work, either make each iteration stateless or use separate threads.
- **Advance dedup markers before processing, not after.** BBG was replying to the same mention multiple times because the "last processed" marker only advanced after the loop completed successfully. Set it first so a crash can't re-process.
- **Research before building integrations.** For any new third-party API (IRS, state, Plaid, document OCR), do a research pass first, then build. Coding from memory against unfamiliar APIs wastes cycles. This is also saved in BBG's memory.
- **`mastra dev` doesn't auto-load `.env`.** The `dev` script in `package.json` passes `--env .env` explicitly for a reason.
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
