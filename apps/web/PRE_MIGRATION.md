# Pre-migration snapshot — apps/web

Read this before starting the Vite → Next.js + Render → Vercel migration. It captures everything a new session needs to know about the current web app, the auth model, the integration points with the agent, and the open issues that should land as part of the migration.

For higher-level project context (what Wheel of Time is, the agent architecture, the corpus, etc.), see the repo-root `CLAUDE.md` and `docs/roadmap.md`. This doc is just the web app.

## Current shape

- **Vite SPA**, React 18, `react-router-dom` v6, Tailwind, `@supabase/supabase-js`, `@mastra/client-js`.
- Deployed to **Vercel** (static build) at `https://wheel-of-finances.vercel.app`.
- Calls a separate **Mastra agent** deployed to **Render** at the URL configured by `VITE_API_URL` at build time.
- Top-level routing in `src/App.tsx`: `/login` (public) and `/` `/documents` `/activity` (under the `<Layout>` wrapper that gates by auth state).
- A `vercel.json` rewrite catches deep links like `/login` and falls back to `/index.html` so `react-router` can resolve them client-side.

## Auth model (the part the migration needs to replace)

- User signs in via `supabase.auth.signInWithPassword(...)` on `/login`.
- `supabase-js` persists the session in **localStorage** (default for the browser client).
- Every `fetch()` to the agent is wrapped via `lib/auth.ts`'s `authHeaders()` which reads the JWT from the live Supabase session and attaches `Authorization: Bearer {jwt}`.
- `MastraClient` is built per-call in `lib/mastraClient.ts` so the JWT is current at request time (token refreshes get picked up).
- The `<Layout>` component checks `supabase.auth.getSession()` at mount; if no session, redirects to `/login`. It also subscribes to `onAuthStateChange` and redirects on `SIGNED_OUT`.

**The bug this auth model has, that the migration should fix:**

Browser navigations (clicking an `<a href>`, pasting a URL, refreshing) **do not carry the `Authorization` header**. Only `fetch()` calls do, because our JS attaches the header explicitly. So any auth-protected agent route that's reached via plain navigation gets a 401.

Concretely, this breaks:
- The existing **Draft 1040** / **Schedule D** / etc. links on the Documents tab (they navigate to `/documents/{uuid}` on the agent, which is auth-protected → 401).
- **Any PDF link Thom embeds in his chat replies** — same path, same 401.
- Everything in the (uncommitted local-only) **uploads list + View/Download buttons** described below.

This is a web-platform constraint, not a local-vs-prod thing. Same bug ships to Vercel.

**The fix:** switch session storage from localStorage to cookies via `@supabase/ssr`. Cookies are sent automatically by the browser on every navigation, so the agent can read auth from the cookie and authenticate browser-initiated requests too. This is the canonical Next.js Supabase pattern and is the natural thing to adopt as part of the migration.

There are workarounds short of `@supabase/ssr` (have JS intercept clicks and `fetch()` then navigate to the resulting signed URL; or have the route return JSON with a signed URL instead of 302-redirecting). They're hacks. Cookie-based auth is the right answer and migration is the right time.

## File map

```
src/
  App.tsx                       Routes: /login, /, /documents, /activity
  components/
    Layout.tsx                  Auth gate, owns chat-messages state, sidebar slot
    SideNav.tsx                 Reset + Sign out buttons; nav links
    Markdown.tsx                Renders Thom's replies; rewrites relative hrefs through apiUrl()
    ActivityCard.tsx            Right-rail activity feed (mobile shows on /activity route)
  routes/
    Login.tsx                   Email + password form via signInWithPassword
    Chat.tsx                    Streaming chat with Thom; file attachments via base64 inline
    Documents.tsx               "Filing cabinet" — drafts + uploads (uncommitted: View/Download buttons + uploads section)
    Activity.tsx                Activity feed page (mobile-only nav, desktop shows in right rail)
  lib/
    api.ts                      fetchState, fetchActivity, resetSession — all use authHeaders()
    apiBase.ts                  apiUrl() indirection: empty in dev (Vite proxy), VITE_API_URL in prod
    auth.ts                     getAccessToken, getUserId, signOut, authHeaders (all async)
    chatSession.ts              DEMO_THREAD_ID and THOM_AGENT_ID constants
    cn.ts                       Tailwind class merger (clsx + tailwind-merge)
    mastraClient.ts             makeMastraClient() — fresh client per call with current JWT
    supabaseClient.ts           Singleton supabase-js client (URL + publishable key)
    uploads.ts                  uploadDocument(file) — direct supabase-js storage upload + user_documents row
vercel.json                     SPA fallback rewrite
vite.config.ts                  Proxy for /api, /app, /documents → localhost:4111 in dev
.env.example                    VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
```

## Backend integration points

There are three categories of agent-server interaction:

1. **Chat streaming** — `Chat.tsx` uses `MastraClient.getAgent('thom').stream(...)` to send a turn. Sends a `memory: { thread, resource }` config; resource is the user's UUID (server force-overrides via `mapUserToResourceId` regardless). Returns SSE stream of text deltas.

2. **CRUD-like JSON routes** — `/app/state` (case-state for header counters + draft URLs), `/app/activity` (merged facts + decisions feed), `/app/session/reset` (per-user wipe). All `fetch()` with auth header. These are the natural candidates to **eliminate** during the migration by reading directly from Supabase server-side via Server Components or `@supabase/ssr` server clients.

3. **Document downloads** — `/documents/{uuid}` on the agent server validates auth, mints a 60-second Supabase Storage signed URL, 302-redirects. Used today by the Documents page (broken — auth-on-navigation) and chat-message links (also broken).

In the future state, **#2 collapses entirely** (Server Components read Supabase directly) and **#3 either becomes a Next.js API route or moves entirely to frontend-side signed-URL minting**. The agent should be down to chat streaming + agent tools + corpus-RAG only.

## Storage that the frontend reads/writes directly

Already done — these don't go through the agent:

- **Sign-in / sign-out** — `supabase.auth.signInWithPassword(...)`, `supabase.auth.signOut()`.
- **File uploads on chat attach** — `uploadDocument(file)` in `lib/uploads.ts` does `supabase.storage.from('user-documents').upload(...)` + `supabase.from('user_documents').insert(...)`, parallel with the chat stream. No agent involvement.
- **Documents tab uploads list** (uncommitted) — `supabase.from('user_documents').select(...).eq('category', 'uploads')` — RLS-scoped to current user.

These all work today because they're triggered by JS code that has access to the supabase-js client (which carries the JWT internally for its own API calls — the JWT lives on the supabase-js client instance, not via our `authHeaders()` helper).

## What's local-only / uncommitted

Latest commit on `main` is `8f8b7d0` ("Fix reset (use Memory.deleteThread) + switch to transaction-pooler"). Beyond that, locally uncommitted:

- `apps/agent/src/mastra/db/userDocuments.ts` — `signDocumentUrl` accepts an optional `downloadFilename` parameter for `Content-Disposition: attachment`.
- `apps/agent/src/mastra/server/routes/documents.ts` — reads `?download=1` query param and passes the filename to `signDocumentUrl` for download mode.
- `apps/web/vite.config.ts` — added `/documents` to the dev proxy; removed stale `/drafts` entry.
- `apps/web/src/routes/Documents.tsx` — refactored `DocCard` from one big `<a>` to a card with View + Download action buttons; added an "Uploads" section that queries `user_documents` directly via `supabase-js`.

These changes are correct in their layer (server route supports download mode; frontend renders an uploads list) but **none of them work end-to-end** because of the auth-on-navigation issue. Don't commit them as-is; fold them into the migration where cookie-based auth makes them functional.

## Known framework gotchas to carry forward

These trapped us once already; budgeting them up front saves a debugging cycle.

- **`MastraAuthSupabase` constructor silently drops `mapUserToResourceId`.** The TS interface declares it; the runtime doesn't wire it up. Workaround: set `auth.mapUserToResourceId` as a property after construction, OR (preferred) decode the JWT's `sub` claim in middleware and `requestContext.set(MASTRA_RESOURCE_ID_KEY, sub)` ourselves. We do the latter — see `apps/agent/src/mastra/server/userSupabaseMiddleware.ts`. Worth filing upstream when there's spare time.

- **Mastra's `protected` paths default to `["/api/*"]` only.** Custom routes like `/app/*` and `/documents/*` need to be added explicitly to the protected list, or they bypass auth. We do this in `apps/agent/src/mastra/index.ts`.

- **`MastraAuthSupabase`'s default `authorizeUser` checks an `isAdmin` column** that doesn't exist on Supabase Auth users. Override to `() => true` — it's a coarse "user is allowed past the door" gate, not a permission grant. Per-row scoping comes from RLS + `MASTRA_RESOURCE_ID_KEY`.

- **Supabase Postgres pool: always use port 6543 (transaction mode).** Session mode (5432) trips the free-tier 15-connection cap when Mastra hot-reloads ~17 storage domains in parallel. Transaction mode is also what serverless needs. Same `POSTGRES_URL` works locally, on Render, and on Vercel — no environment-specific tweak. See `CLAUDE.md` for the full reasoning.

- **Reset deletes need a universal-true filter for uuid-PK tables.** PostgREST rejects `DELETE` without any filter; the natural-looking `.neq("id", "")` errors on uuid columns because PostgREST tries to parse the empty string as a uuid. We use `.gte("created_at", "1970-01-01")` instead.

- **`mastra_messages` does NOT cascade-delete from `mastra_threads`.** No FK constraint; Mastra handles cascade in code via `Memory.deleteThread()`. If you write your own teardown SQL, you'll silently leave orphan messages that the agent reads as prior context on the next turn (= "reset doesn't clear conversation"). The current code uses `Memory.listThreads({ filter: { resourceId } })` + `Memory.deleteThread(t.id)` per thread.

## Migration shopping list

What should land as part of the Vite → Next.js + Render → Vercel work, organized by what each move enables:

### Cookie-based auth (`@supabase/ssr`)
- Replaces `lib/auth.ts`'s localStorage-backed session.
- Browser navigations now carry auth — the auth-on-navigation 401 goes away.
- Server Components and Route Handlers can read the user's session via the server-side cookie helper.
- The `Authorization`-header-attaching helper in `authHeaders()` becomes unnecessary for same-origin requests; only kept if some code path still hits a separate origin (it shouldn't, post-migration).

### Routes that should become Server Components / direct Supabase reads
- **Documents page** — query `user_documents` directly server-side; no `/app/state`-style indirection. Both drafts and uploads come from the same table.
- **Activity feed** — same: `tax_facts` + `ai_decisions` UNION-style query, server-rendered.
- **Header counters** ("0 facts · 3 open · 0%") — these come from `/app/state` today; can come from a single Server Component query.

### Routes that stay (and where they live)
- **Chat streaming** stays an agent route (it streams LLM output, calls tools, runs workflows). On Vercel it's a serverless function under the same domain as the frontend.
- **`/documents/{uuid}` for chat-message PDF links** — once cookie auth lands, this works again. Either keep it on the agent or move to a Next.js route handler. Either way it's just "lookup → mint signed URL → redirect."
- **Per-user reset** — needs admin pool access (it deletes Mastra threads via the framework's `Memory.deleteThread`). Lives wherever the agent lives.

### Things that get deleted in the migration
- `vercel.json` SPA fallback (Next.js handles routing natively).
- `apiBase.ts` + `apiUrl()` indirection — same-origin makes this unnecessary.
- `vite.config.ts` proxy entries — Next.js doesn't need them.
- `Markdown.tsx`'s relative-link rewriting through `apiUrl()` — same reason.
- `lib/auth.ts`'s `authHeaders()` helper for most call sites — server-side calls don't need it.

### Things that should be preserved or carried forward unchanged
- React component logic (Layout shape, SideNav, Chat streaming UX, Markdown rendering, ActivityCard).
- Tailwind config + design tokens.
- `supabase-js` usage patterns.
- `MastraClient` chat streaming logic (still needed for the chat turn itself).
- `lib/uploads.ts` — supabase-js storage upload pattern works identically in Next.js client components.
- The user-data schema (`tax_facts`, `ai_decisions`, `open_questions`, `user_documents`) and RLS policies on Supabase — no DB migration needed.

### On the agent side (Render → Vercel)
- Mastra runs on Vercel via `@mastra/deployer-vercel`.
- `corsMiddleware` likely deletable — frontend and agent same-origin under one Vercel project.
- `/app/*` routes on the agent get retired as their work moves to Next.js Server Components.
- `userSupabaseMiddleware` simplifies to "for tools only" once `/app/*` routes go away (tools still need a user-scoped Supabase client per request).
- `render.yaml` deletes; Vercel project settings take its place.
- POSTGRES_URL stays on transaction mode (port 6543) — already correct.

## Suggested migration sequence

(Picked up from `docs/roadmap.md` for convenience — see that doc for the broader project sequencing.)

1. **Mastra agent → Vercel** while the Vite frontend is still around. Just changes hosting; frontend updates `VITE_API_URL` to point at the new agent project. Stable backend during the harder frontend swap.
2. **Vite → Next.js**. Adopt `@supabase/ssr` from day one — solves auth-on-navigation, retires `authHeaders()`, retires `apiUrl()`. Move the `/app/state`/`/app/activity` work into Server Components reading Supabase directly. Decide whether to co-deploy the agent in the same Next.js project (cleaner same-origin) or keep them as two Vercel projects.
3. **Documents page polish** — fold the uncommitted Download/uploads-list changes into the Next.js version so they actually work end-to-end with the new auth.

## Testing the migration

Smoke checklist for the first end-to-end pass:

- Sign in with email + password → land on `/`
- Refresh → still signed in (cookie persists)
- Paste `/documents` directly into URL bar → loads the page (no SPA-fallback weirdness)
- Send Thom a message, attach a W-2, get a structured-data response
- Switch to Documents tab → see the W-2 in Uploads with View/Download buttons that actually work
- Generate tax docs via the agent → drafts appear in Documents with View/Download
- Click any PDF link in the chat history → opens the PDF (auth-on-navigation works because cookie)
- Sign out → redirected to `/login`; refreshing or pasting `/` redirects back to `/login`
- Click Reset → chat clears, all rows gone from `tax_facts` / `ai_decisions` / `user_documents` / `mastra_threads` / `mastra_messages`

If those all pass, the migration is structurally sound. The remaining work is polish and the bigger architectural moves (form-engine extraction to a shared package, etc.) that are tracked in `docs/roadmap.md`.
