import "dotenv/config";
import { createClient } from "@libsql/client";
import { Mastra } from "@mastra/core";
import { PinoLogger } from "@mastra/loggers";
import { thom } from "./agents/thom";
import { nynaeve } from "./agents/nynaeve";
import { resetMastraSchema } from "./db/resetMastraSchema";
import { resetUserData } from "./db/resetUserData";
import { cleanGeneratedFiles } from "./fs/cleanGeneratedFiles";
import { createDemoAuth } from "./server/auth";
import { corsMiddleware } from "./server/cors";
import { createObservability } from "./server/observability";
import { appActivityRoute } from "./server/routes/appActivity";
import { appStateRoute } from "./server/routes/appState";
import { draftsRoute } from "./server/routes/drafts";
import { sessionResetRoute } from "./server/routes/sessionReset";
import { createStorage, dbUrl, pgPool } from "./server/storage";

// RESET_USER_DATA_ON_START=1 → wipe runtime state on boot. Two stores to
// clear during the libsql → Postgres transition:
//   - libsql: legacy domain tables (tax_facts, open_questions, ai_decisions)
//   - postgres: Mastra's mastra.* schema (threads, messages, traces, …)
// The libsql half collapses once domain helpers move to Supabase (step 6).
if (process.env.RESET_USER_DATA_ON_START) {
  const resetClient = createClient({ url: dbUrl });
  const { dropped, preserved } = await resetUserData(resetClient);
  resetClient.close();
  const { truncated } = await resetMastraSchema(pgPool);
  const { deleted } = cleanGeneratedFiles();
  console.log(
    `[reset-on-start] libsql: dropped ${dropped.length}, preserved ${preserved.length} (${preserved.join(", ") || "none"}); postgres mastra: truncated ${truncated.length}; files: wiped ${deleted.length}`,
  );
}

const storage = await createStorage();

export const mastra = new Mastra({
  agents: { thom, nynaeve },
  storage,
  logger: new PinoLogger({ name: "wheel-of-time", level: "info" }),
  observability: createObservability(),
  server: {
    auth: createDemoAuth(),
    // Mount Studio under /studio rather than the URL root. Frontend lives on
    // Vercel; this server only handles API + Studio + custom routes.
    studioBase: "/studio",
    middleware: [
      // CORS first so cross-origin preflights short-circuit before everything
      // else. Configured by ALLOWED_ORIGINS env var; permissive when unset.
      corsMiddleware,
    ],
    apiRoutes: [
      appStateRoute,
      appActivityRoute,
      sessionResetRoute,
      draftsRoute,
    ],
  },
});
