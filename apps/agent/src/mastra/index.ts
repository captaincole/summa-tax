import "dotenv/config";
import { Mastra } from "@mastra/core";
import { MastraAuthSupabase } from "@mastra/auth-supabase";
import { VercelDeployer } from "@mastra/deployer-vercel";
import { PinoLogger } from "@mastra/loggers";
import { thom } from "./agents/thom";
import { nynaeve } from "./agents/nynaeve";
import { resetAllUserData } from "./db/resetUserData";
import { corsMiddleware } from "./server/cors";
import { createObservability } from "./server/observability";
import { appActivityRoute } from "./server/routes/appActivity";
import { appStateRoute } from "./server/routes/appState";
import { documentsRoute } from "./server/routes/documents";
import { sessionResetRoute } from "./server/routes/sessionReset";
import { createStorage, pgPool } from "./server/storage";
import { userSupabaseMiddleware } from "./server/userSupabaseMiddleware";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required (see .env.example)",
  );
}

// RESET_USER_DATA_ON_START=1 → full wipe across all users on boot. Intended
// for ephemeral deploys (dev redeploys, CI) that want a clean slate. Truncates
// mastra.* (framework runtime) and public.{tax_facts, open_questions,
// ai_decisions} (our domain), and wipes generated PDFs from disk.
if (process.env.RESET_USER_DATA_ON_START) {
  const { truncated } = await resetAllUserData(pgPool);
  console.log(
    `[reset-on-start] truncated ${truncated.length} tables (${truncated.join(", ") || "none"}); user-documents storage retains orphan blobs (cleanup is a future job)`,
  );
}

const storage = await createStorage();

export const mastra = new Mastra({
  agents: { thom, nynaeve },
  storage,
  logger: new PinoLogger({ name: "wheel-of-time", level: "info" }),
  observability: createObservability(),
  // `mastra build` emits .vercel/output/ for deployment.
  // studio: false → deployer emits a catch-all route ({src: "/(.*)", dest: "/"})
  // that sends every request to the function, including /app/* and /documents/*.
  // With studio: true the deployer hardcodes /api/* and /health as the only
  // function routes and falls everything else through to a Studio SPA — which
  // would 404 our custom Hono routes. Until those routes get deleted in the
  // Next.js migration (per apps/web/PRE_MIGRATION.md step 2), no prod Studio.
  // Run `mastra studio` locally pointed at the prod URL when needed.
  // maxDuration: 300 = Pro default; revisit if a Thom turn ever exceeds 60s,
  // at which point we move Nynaeve to a background queue rather than raise it.
  // sfo1 keeps the function in the same region as Supabase US-West.
  deployer: new VercelDeployer({
    studio: false,
    maxDuration: 300,
    memory: 1536,
    regions: ["sfo1"],
  }),
  server: {
    // Validates Supabase JWTs on every protected request. authorizeUser:
    // () => true is a coarse "authenticated user is allowed past the door"
    // gate (NOT a permission grant) — per-row scoping comes from RLS at the
    // public.* tables and from MASTRA_RESOURCE_ID_KEY (set by
    // userSupabaseMiddleware) at the mastra.* tables. /app/* is in `protected`
    // alongside the default /api/* so our custom routes go through auth too.
    auth: new MastraAuthSupabase({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_PUBLISHABLE_KEY,
      authorizeUser: () => true,
      protected: ["/api/*", "/app/*", "/documents/*"],
    }),
    // Mount Studio under /studio rather than the URL root. Frontend lives on
    // Vercel; this server only handles API + Studio + custom routes.
    studioBase: "/studio",
    middleware: [
      // Debug shim: per-request timing log. PinoLogger writes are async-
      // buffered and get truncated on serverless function exit; plain
      // console.log reaches Vercel reliably. Logs at start (so a hung
      // request still leaves a breadcrumb) and again on completion with
      // total duration + status. Remove once logging is sorted.
      async (c: any, next: () => Promise<void>) => {
        const start = Date.now();
        console.log(`[req] ${c.req.method} ${c.req.path} START`);
        await next();
        console.log(
          `[req] ${c.req.method} ${c.req.path} ${c.res.status} in ${Date.now() - start}ms`,
        );
      },
      // CORS so cross-origin preflights short-circuit before everything else.
      // Configured by ALLOWED_ORIGINS env var; permissive when unset.
      corsMiddleware,
      // Builds a per-request user-scoped Supabase client from the bearer JWT
      // and stashes it on requestContext + Hono context. Tools and routes
      // pull it via tools/userContext.ts and HONO_CONTEXT_KEYS respectively.
      userSupabaseMiddleware,
    ],
    apiRoutes: [
      appStateRoute,
      appActivityRoute,
      sessionResetRoute,
      documentsRoute,
    ],
  },
});

// Eagerly trigger MastraCompositeStore.init() at module load so the ~10s of
// schema-migration work (CREATE TABLE / ALTER TABLE across ~14 sub-stores)
// runs during Vercel's post-deploy function pre-warm rather than on the first
// user-facing memory request. Wrapped in async-IIFE + try/catch so any sync
// throw can't crash the process; if init fails the next memory access just
// retries normally. Doesn't help with idle-eviction cold starts (user races
// the same init promise), but does cover the common post-deploy case where
// the first real user would otherwise pay 10s.
void (async () => {
  try {
    await (storage as { init?: () => Promise<void> }).init?.();
    console.log("[warmup] storage init done");
  } catch (err) {
    console.log(
      "[warmup] failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
})();
