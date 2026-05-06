# Roadmap

Snapshot of where the project is, what's left to clean up, and the two big migrations queued next.

## What's shipped

```
14f3376  Add Vercel SPA fallback so /login (and deep links) work
8a347a4  Move domain tables to Supabase + per-user RLS active
6f38717  Swap demo passcode for Supabase auth + per-user resource scoping
59804b8  Move Mastra runtime storage from libsql to Supabase Postgres
```

**Storage layer.** Mastra runtime tables (`mastra_threads`, `mastra_messages`, `mastra_resources`) and our domain tables (`tax_facts`, `open_questions`, `ai_decisions`) live in Supabase Postgres. The reference corpus was already there.

**Auth layer.** Demo passcode replaced by Supabase Auth (`MastraAuthSupabase` server-side, `signInWithPassword` frontend). Per-user resource scoping comes from `userSupabaseMiddleware`, which decodes the JWT's `sub` claim and sets `MASTRA_RESOURCE_ID_KEY`. Per-row data isolation comes from RLS policies on the public domain tables, with the request-scoped `supabase-js` client carrying the JWT through to PostgREST.

**Architectural shape.** Auth doors are provider-specific (web today, Slack/WhatsApp in the future) but all converge on the same `(user_id, supabase client)` pair stashed on `requestContext`. The agent code is identity-blind — tools and routes pull the pair out and operate; they don't know how the user authenticated.

---

## Phase 6b cleanup

Some items are now blocking for Mastra-on-Vercel and called out as such.

- Drop `@libsql/client` and `@mastra/libsql` deps. **Blocking** — won't work on Vercel anyway.
- Delete `wheel-of-time.db*` files at the repo root and ensure they stay gitignored.
- Drop `DATABASE_URL` env var and the legacy `dbUrl` export from `server/storage.ts`. **Blocking** — Render config needs updating too.
- Drop the unused `DEMO_TAXPAYER_ID` constant in `server/demoSession.ts`.
- Move `DRAFTS_DIR` from local filesystem to a Supabase Storage `drafts` bucket. **Blocking for Vercel** — serverless has no persistent disk.
  - Generated PDFs (1040, 8949, Schedule D, 540, sidecar JSON) write via `supabase.storage.from('drafts').upload(...)`.
  - `/drafts/:filename` route returns a signed URL instead of streaming a file.
  - `appState.ts` PDF-existence checks query Storage instead of `existsSync`.
  - `cleanGeneratedFiles` becomes a Storage list-and-delete.
- Rewrite operator scripts: `smokeReview.ts`, `testDraft1040.ts`, `testForm540.ts`, `testForm8949.ts`, `testRenderForms.ts`, `testForm1040NoSales.ts`, `testScheduleD.ts`, `inspectDecisions.ts`. They call old helper signatures; each needs a service-role Supabase client and the new API.

---

## Project 1: frontend Vite → Next.js

What transfers cleanly:

- React components (Layout, SideNav, Chat, Login, Documents, Activity, Markdown, ActivityCard).
- Tailwind config and tokens.
- The `supabase-js` client and auth helpers.
- The `MastraClient` + chat streaming logic in `Chat.tsx`.

What gets restructured:

- Auth: `useEffect`-based session checks → Next.js middleware. Adopt `@supabase/ssr` for cookie-based sessions; cleaner than the localStorage-in-`supabase-js` flow we have today.
- Routing: `<Routes>` → `app/` directory.
- The `vercel.json` SPA rewrite goes away — Next.js handles it natively.
- `VITE_API_URL` / `apiBase.ts` / `apiUrl()` collapse depending on whether the agent stays cross-origin or co-deploys.

What this conversion enables (do these as part of the move, not separately):

- **Direct Supabase reads from server components**, replacing `/app/state` and `/app/activity` agent routes entirely. The form engine runs as a server-component computation OR gets extracted to a shared `packages/forms` workspace consumed by both apps. Once those routes go away, `userSupabaseMiddleware` collapses to "for tools only."
- **First-party API routes** for anything that genuinely needs admin access (per-user `mastra.*` reset, document upload preprocessing).
- **Server-side login flow** via `@supabase/ssr` — no client-side flicker on protected route loads.

---

## Project 2: agent Render → Vercel

Hard requirements (block deploy):

- LibSQLStore must be gone — done in Phase 6a; finish the dep cleanup in Phase 6b.
- `DRAFTS_DIR` filesystem must move to Supabase Storage — see 6b.
- `POSTGRES_URL` switches to Supavisor **transaction mode** (port 6543), not session mode (5432). Each cold function is a fresh process; transaction-mode pooling is what serverless wants.
- Use `@mastra/deployer-vercel` instead of `mastra build` + Render Node.

Soft considerations:

- Cold start. Mastra construction does real work. Module-scope construction keeps it once-per-warm-container; Vercel keeps containers warm ~5–15 min.
- Mastra Studio runs alongside the API in the same Vercel project. `studioBase: "/studio"` config stays.
- `render.yaml` deletes; Vercel project settings + env vars take its place.
- If the frontend (Next.js) and agent co-deploy as one Vercel project, `corsMiddleware` and `VITE_API_URL` go away — same-origin everything.
- Channel webhooks (Slack, WhatsApp, etc.) land naturally as Vercel functions; Mastra's `Channels` adapters Just Work on the same deploy.

---

## Other architectural debt

Tracked here so it doesn't decay out of context. None of these block the two big projects.

- **DB-level RLS on `mastra.*` tables.** Today we rely on Mastra's framework-layer scoping (`mapUserToResourceId` + 403-on-mismatch). Defense-in-depth via custom DB role + AsyncLocalStorage + per-query `SET LOCAL request.jwt.claims` is the path; about 80 lines of pool wrapper. Worth doing post-migration when scope settles.
- **Mastra framework bug.** `MastraAuthProvider`'s constructor and `registerOptions` silently drop `mapUserToResourceId` from options despite the TS interface declaring it. Worked around in `userSupabaseMiddleware` (we set `MASTRA_RESOURCE_ID_KEY` ourselves). File upstream when convenient; the workaround is fine indefinitely.
- **`open_questions` table.** Schema and tools exist but Thom's prompt doesn't use them consistently. Either lean in or drop the surface area.
- **Operator scripts.** Broken since Phase 6a. Only relevant for refdocs operations. Rewrite as part of 6b.

---

## Recommended sequencing

1. **Phase 6b cleanup** first. Several items are prerequisites for Mastra-on-Vercel (libsql gone, DRAFTS_DIR on Storage). The mechanical bits — dep removal, env var cleanup, unused-constant removal — are quick wins; the Storage migration is the substantive piece.

2. **Mastra → Vercel**. Once filesystem dependency is gone, the move is mostly config (`@mastra/deployer-vercel`, transaction-mode pool, drop `render.yaml`). Frontend stays on Vite during this step; only `VITE_API_URL` changes (points at the new Vercel agent project instead of Render).

3. **Frontend → Next.js**. Naturally folds in the route-elimination work (`/app/state` and `/app/activity` become server components reading direct Supabase). `userSupabaseMiddleware` collapses to tools-only when those routes go away. End state matches the architecture sketched in `CLAUDE.md`'s "Future architecture" section.

Reverse order (Next.js first, then Mastra) also works if having a modern frontend matters more than a stable backend during the transition. Tradeoff: live with two cross-origin deploys briefly.
