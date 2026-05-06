import "dotenv/config";
import { Mastra } from "@mastra/core";
import { MastraAuthSupabase } from "@mastra/auth-supabase";
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
      // CORS first so cross-origin preflights short-circuit before everything
      // else. Configured by ALLOWED_ORIGINS env var; permissive when unset.
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
