# Open-Source Transition Plan

Tracking doc for converting this project from a hosted, multi-tenant product into a
self-hosted, single-user, open-source app (working name **Luca**, after Luca Pacioli).
Read this + `CLAUDE.md` to resume from a cold start. Update the checkboxes as steps land.

**Current status:** _PHASES 1–3 COMPLETE (2026-07-06). Zero external services; one agent (Luca) + the review workflow with private judges; `smoke:review` is GREEN again (automated grounding coverage restored). Next: Phase 4 (self-host packaging). Gate = unit 25/25 + goldens 14/14 + smoke:review 3/3._

---

## New usage model

1. **Self-hosted.** Users run their own agent — locally or via a provided prod-deploy guide. We host nothing.
2. **Single-user per agent.** One owner per instance. Auth complexity and large-DB concerns go away.
3. **Two front doors.** Talk to the agent directly, or use the web UI as the easier surface.

## Settled decisions (the "why", so we don't relitigate)

- **Database → libsql (one driver everywhere).** Rip out Supabase entirely. `@mastra/pg` → `@mastra/libsql` for the runtime store, and the **same `@libsql/client`** for the corpus + domain tables. FTS5 for text, **libsql native vectors** (`F32_BLOB` + `vector_distance_cos`) — NOT sqlite-vec. No server, no Docker — "the DB is a file." Deletes all the pooler-6543 / `disableInit` / connection-limit machinery.
  - _Why libsql-native over sqlite-vec (settled 2026-06-13):_ Mastra's runtime store already mandates `@libsql/client`, so libsql is in the tree regardless; using it for the corpus too means **one SQLite driver** in the codebase instead of two. sqlite-vec's only edge (a more vendor-neutral shippable `.db`) is low-value since the corpus is prebuilt + read-mostly. libsql native vectors are fine at our scale (low-thousands of blocks).
  - _Our RAG pattern stays; we do NOT adopt Mastra's RAG._ Mastra RAG = flat "chunks + embedding + metadata blob, query by cosine." Ours = relational doc graph (documents→sections→blocks) with **stable citable IDs** + **hybrid FTS5+vector retrieval** + rerank. The two don't converge: Mastra's vector store has no lexical leg (kills the "no-Voyage → FTS fallback" goal) and buries citations in a metadata blob. So Phase 1 step 1 is an **engine swap only** (Postgres→libsql) under our existing retrieval architecture — we use the libsql engine, not Mastra's `LibSQLVector` abstraction.
- **Corpus → shipped `.db`.** Pre-built, Voyage-embedded corpus shipped as a release/seed asset so first-run costs $0 and needs no Voyage key for ingest. `refdocs:sync` stays as the dev path for extending coverage.
- **Voyage expected, not required.** Anthropic key is always required (Luca + the grounding judge are LLM calls). Without a Voyage key, retrieval **gracefully degrades to FTS5 keyword search**; with one, semantic + rerank light up. No bundled local model.
- **Keep the share/CPA schema dormant.** Single-user means delete RLS *enforcement*, not the owner/membership/CPA tables. Keeping them costs nothing and future-proofs "share with spouse/CPA."
- **Remove Nynaeve; grounding becomes a workflow.** The critic agent goes away. Grounding = deterministic **retrieve → judge** pipeline (no agentic loop). Triggers on `record-ai-decision`, runs **fire-and-forget async** (self-host = long-running process, so this is now allowed); verdict written back to the row; `pending`/`inaccurate` surfaced into open-asks so Luca circles back. Grounds **decisions, not facts** (a fact is verbatim — nothing to ground).
- **Rebrand to Luca.** Strip Wheel of Time names (Thom, Nynaeve, "wheel-of-time" IDs) — they're Robert Jordan/Amazon IP. Thom → Luca.
- **License: AGPL-3.0 + CLA/DCO.** AGPL with a contributor agreement so the owner retains unilateral relicense rights. Must be in place before the first external PR.

---

## The test net (build first — this is the regression gate for every step)

Lock in the existing safety surface before touching anything; every later step is "do these still pass?"

**Baseline captured 2026-06-13 (on Supabase main, pre-transition):**

- [x] **Goldens** — `npm test` → 14/14 green (alex / marcus / alejandro scenarios + 11 catalog-fill checks, byte-compared PDFs). Plus `npm run test:unit` → 25/25. **This is the real net:** identical goldens after a DB swap proves the fact/form engine survived.
- [x] **`smoke:review`** — **GREEN again as of Phase 3 (2026-07-06).** Rewritten for the libsql stack (temp DB, direct workflow invocation). Original note: **RED, deferred to Phase 3.** Stale: predates the Supabase RLS / user-scoped-client refactor (`recordFact`/`recordAIDecision` signatures changed; needs a seeded user+filing + fabricated runtime context). Left untouched on purpose — Phase 3 deletes the Nynaeve pipeline and rewrites grounding as a deterministic workflow, so the real automated grounding test gets built then. Grounding has **no automated baseline** until Phase 3; verify it manually in the meantime.
- [x] **One manual browser pass** — verified 2026-06-13 (rand@localhost): fact ingest → draft 1040 updates → doc download all working. Manual stand-in for the deferred `smoke:review`; re-run by hand each phase until Phase 3 builds the real grounding test.

_Note: `smoke:engine` was deleted during baselining — it was a stale hand-maintained placeholder fully superseded by the scenario goldens (its own header called it a Phase-F placeholder)._

---

## Sequenced plan (10 gated stops — each is a shippable commit)

### Phase 0 — Branding & license ✅ DONE (2026-06-13, commits 1774a60 + 0b05c41)
**Names settled:** agent = **Luca**; project/product = **Summa** (after Pacioli's *Summa de arithmetica*); internal `wheel-of-time` IDs → `summa-*`. Unix dir stays `project-merrilin`.
- [x] Rename Thom → Luca (incl. the `luca` agent id + its wire surface `/api/agents/luca/stream`, `LUCA_AGENT_ID`)
- [x] Merrilin → Summa (product); `wheel-of-time` / "Wheel of Time" → `summa` / Summa (package names, lockfiles, logger, storage ids, docs, migration comments, env templates)
- [x] Rename seed user → `casey@localhost.com` / Casey Morgan
- [x] **Nynaeve: left untouched on purpose** — Phase 3 deletes the critic agent, so renaming now is throwaway; repo private until Phase 5
- [x] Add `LICENSE` (AGPL-3.0). **Contributor mechanism (CLA vs DCO) deferred to Phase 5**
- [x] **Gate met:** agent tsc 0, web tsc 0, `test:unit` 25/25, `npm test` 14/14, manual browser pass verified (casey@).
- _Bonus fix landed (0b05c41): `/app/state` 500 — case-state evaluated catalog-only forms missing from the runtime catalog. Pre-existing, unrelated to the rename; surfaced during the boot gate._

### Phase 1 — Rip out Supabase → SQLite (the only real engineering risk; one role at a time)
1. [x] **Corpus → SQLite.** ✅ DONE (2026-07-03, commit 618ec3e). Ported `match_ref_blocks` PG fn → TS (FTS5 `MATCH` + **libsql-native `vector_distance_cos`** brute-force, merge/dedupe in JS); new `db/libsql.ts` (`getCorpusDb` + `ensureCorpusSchema`); rewrote `refDocs.ts` read+write (public API unchanged, so tool/ingest/workflow untouched); repointed `checkCorpus`/`refdocsStatus`/`refdocsReembed` off Supabase. `.data/` gitignored; corpus rebuilt via `refdocs:sync` (10 docs / 527 blocks / 100% embedded). _Gate met:_ FTS+vector+hybrid all correct via `compareRetrieval`; goldens 14/14; unit 25/25; agent+web tsc 0. `smoke:review` stays RED (Phase 3). Manual browser grounding pass ✅ verified (runtime resolves `CORPUS_DB_PATH`, Nynaeve grounds against the libsql corpus). _Note: spike proved libsql#1811 (FTS5-insert panic) gone on `@libsql/client` 0.17.4._
2. [x] **Domain tables → SQLite.** ✅ DONE (2026-07-05). All 11 domain tables → libsql `app.db` (`db/appDb.ts`); no data migration (wipe + reseed per project convention). **RLS → explicit code scoping:** helpers take `Scope { userId, filingId }`; routes gate via `getMembership` before building a scope. Web: browser can't read a server-side file, so client reads moved behind 5 Next API routes (`/api/{activity,uploads,drafts,requested-actions}`), server components read libsql directly via `lib/serverDb.ts`; **Supabase Realtime → plain 3s interval polling**. Seed: GoTrue users stay (auth is Phase 2); filings/CPA rows → libsql. _Interim wart (deleted in step 4):_ blobs still in Supabase Storage but the bucket RLS references now-empty Postgres `filing_members` — all storage I/O goes through service-role clients, gated by our explicit membership checks. _Gate met:_ goldens 14/14, unit 25/25, both tsc 0, web prod build clean, `/app/state` 200 against libsql, manual browser pass (fact → activity poll → upload)._
3. [x] **Mastra runtime store → libsql.** ✅ DONE (2026-07-05). `@mastra/pg` → `@mastra/libsql@1.9.1` (pinned — `@latest` wanted core ≥1.32 and dragged `@mastra/core` 1.31→1.49; rolled back, framework bumps get their own commit). Runtime tables → `.data/mastra.db` (separate file from app.db so framework migrations can never touch user data; WAL mode). **Deleted:** `disableInit`, `scripts/migrateMastra.ts` + build-chain hook, `pgPool` + query logger, `pg`/`@mastra/pg`/`@types/pg` deps — the agent no longer needs `POSTGRES_URL` at all. Seed creates threads via the Memory API. `inspectLastReview` ported (traces section dropped — observability is in-memory). _Gotcha:_ module-relative DB-path defaults resolve differently in Mastra's bundled output (`.mastra/output/`) vs tsx source — `MASTRA_DB_PATH`/`APP_DB_PATH`/`CORPUS_DB_PATH` env vars are the real mechanism; revisit defaults for Phase 4 clean-clone UX. _Gate met:_ chat persists across agent restart (manual browser pass), goldens 14/14, unit 25/25, both tsc 0.
4. [x] **Blobs → filesystem.** ✅ DONE (2026-07-05). Document bytes → `.data/documents/{filingId}/{category}/{slug}-{ulid}.{ext}` via `db/blobStore.ts` (agent) + `lib/blobStore.ts` (web mirror); `storage_path` keeps the same relative convention so metadata rows + `/documents/{id}` URLs are untouched. Web download route streams bytes directly (Content-Disposition inline/attachment) — no bucket, no signed URLs. **Deleted the step-2 interim wart wholesale:** `supabaseAdmin.ts`, all service-role storage calls, web `SUPABASE_SECRET_KEY`. `DOCUMENTS_PATH` env added everywhere. _Note: UI's "Reset session" became "Delete filing" (avatar menu) somewhere along the way — CLAUDE.md stale, fix in the step-5 doc sweep._ _Gate met:_ delete filing → recreate → upload → preview/download → drafts download (manual browser pass); goldens 14/14, unit 25/25, both tsc 0, web prod build clean.
5. [x] **Delete Supabase (except auth).** ✅ DONE (2026-07-06). **Deleted:** all 11 `supabase/migrations/` + seed SQL scripts; Realtime + Storage disabled in `config.toml` (the Docker stack now boots auth only); forms catalog (`forms`/`form_fields`) → `corpus.db` (dormant `loadFromDb` + ingest-pipeline writes ported to libsql); dead `ctx.supabase` plumbing out of `requireUserContext`/tools/review workflow; `POSTGRES_URL` + `DATABASE_URL` relics scrubbed; `.env.example`s rewritten (`.env.local.example`s deleted); CLAUDE.md stale sections rewritten (pooler, two-migration-systems, corpus location, reset button, first-boot). **What survives until Phase 2 (auth only):** `db/supabase.ts`, auth middleware, `studioAuth`, web `lib/supabase/*`, seed's GoTrue user creation, the Docker stack. _Gate met:_ fresh `db:stop`/`db:start`/`db:reset` against the trimmed config + full browser flow (manual pass); goldens 14/14, unit 25/25, both tsc 0, web prod build clean.
- _If a step breaks goldens you know exactly which layer did it._

**PHASE 1 COMPLETE (2026-07-06).** Every persistence role is a local file under `apps/agent/.data/` — corpus.db, app.db, mastra.db, documents/. The only Supabase left is GoTrue auth; Phase 2 removes it (design direction discussed 2026-07-06: owner row in app.db + first-run setup, simple password session cookie, proxy remaining agent calls through Next to kill the bearer/cookie split, static AGENT_API_TOKEN for direct agent access, then delete the Docker stack).

### Phase 2 — Single-user simplifications ✅ DONE (2026-07-06)
- [x] **Auth = instance identity + one gate.** `owner` row in app.db (profile + scrypt password hash + auto-generated session-secret — no SESSION_SECRET env); first-run `/setup` screen creates it; login = one password → HMAC-signed httpOnly cookie (`lib/localAuth.ts`, ~100 lines, node:crypto only). Persists across restarts (secret on disk, 30-day cookie).
- [x] **Bearer/cookie split deleted.** Browser → Next only; ALL agent calls proxied via `/api/agent/[...path]` (cookie-authed, streaming pass-through, server-side forward to `AGENT_INTERNAL_URL`). Agent: `ownerMiddleware` resolves the owner from app.db (memory scoping + authEmail); optional `AGENT_API_TOKEN` gate for non-localhost deployments; `MastraAuthSupabase`/`studioAuth` deleted.
- [x] **Supabase fully deleted.** `@supabase/*` + `@mastra/auth-supabase` deps, `supabase/` dir, GoTrue seeding (seedLocal.ts), all `db:*` scripts, every SUPABASE_* env var. **Docker is no longer a dependency — `npm run dev:all` is the entire local story.**
- [x] Owner/membership + CPA tables stay dormant (single owner holds every membership).
- [x] First-run `/setup` replaces seeded demo users; "Start your 2025 filing" creates the filing.
- **Gate met:** factory-reset first-run → setup → login → chat (through proxy) → upload → drafts (manual pass); goldens 14/14, unit 25/25, both tsc 0, web prod build clean.
- _Architecture settled en route (sketch session 2026-07-06): agent = the application; web = the rendered case state ("case file") + embedded chat pane as the single web→agent edge; DB = the contract. Channels (Discord etc.) become optional additional conversation surfaces. Deferred: shrink the edge further (filing lifecycle → web DB writes; case state materialized to DB) and possibly serve the UI from the agent process — revisit at Phase 4._

### Phase 3 — Nynaeve → async grounding workflow ✅ DONE (2026-07-06)
_Reality had drifted ahead of the plan: the monolithic critic agent was already gone, replaced by the reviewDecision workflow (init → gather → assess → rule ×≤3 → finalize) over three narrow structured-output judges. Phase 3 became relocate + test:_
- [x] **Judges are workflow internals, not agents.** `agents/nynaeve/` → `workflows/reviewDecision/judges/` (queryFormulator / assessRiskAgent / ruleAgent / cpaRules); **deregistered from the Mastra instance** — `agents: { luca }` is now the truthful statement (they were exposed as chattable agents in Studio/API). Last Robert Jordan IP reference gone.
- [x] Fire-and-forget on `record-ai-decision` + verdict write-back — already true; verified by smoke.
- [x] `inaccurate` now also writes an `open_questions` row (previously only `needs_more_facts`).
- [x] **Workflow fix found by the new test:** `initStep` re-resolved the owner filing (one-filing-per-year assumption) instead of using the caller's scope — scope now flows through the workflow input.
- [x] **`smoke:review` GREEN — first automated grounding coverage since the baseline.** Rewritten for the libsql/Scope stack: temp app DB (real dev DB untouched; corpus read-only), direct `reviewDecision(scope, id)` invocation, asserts verdict/persistence/citations/open-question side effects. 3/3. Case 3 (CA residency) pinned to pipeline mechanics — verdict is borderline-by-design (540 booklet has thin residency detail); judge calibration belongs to a future eval dataset.
- **Gate met:** smoke:review 3/3 (incl. `inaccurate` → open-asks), goldens 14/14, unit 25/25, tsc 0.

### Phase 4 — Self-host packaging
- [ ] One `.env.example` (Anthropic required; Voyage optional) + graceful-degrade wiring
- [ ] Ship pre-built corpus `.db` as a release/seed asset
- [ ] `docker compose up` *or* `npm run dev:all`; deploy-to-prod guide
- **Gate:** clean clone boots from `.env.example`

### Phase 5 — Make it look great
- [ ] README: what it does, honest disclaimers (data→Anthropic each turn; not tax advice; narrow scenarios), quickstart
- [ ] Architecture doc, CONTRIBUTING, scenario-coverage table
- **Gate:** a stranger can clone, run, and understand it from the README alone

---

## Open questions (decide before the relevant phase)

- **Agent sub-naming theme** — under Luca, do future specialist agents get a theme (historical accountants/mathematicians) or plain functional names? _(Only matters when a 2nd agent lands; Nynaeve is being deleted, so no rename pressure now.)_
- ~~**CLA vs DCO**~~ — _deferred to Phase 5 (2026-06-13). License stubbed AGPL-3.0 in Phase 0; mechanism + tooling chosen just before the first external PR._
- **Prod-deploy target** — what we recommend for self-hosters who want hosted (Fly.io / Railway / a VPS / Vercel-still-works?). Affects Phase 4 guide.
- **Honest-data posture** — exact README wording on "tax data goes to Anthropic each turn" + scenario limits.
