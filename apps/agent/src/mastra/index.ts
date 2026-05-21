import "dotenv/config";
import { Mastra } from "@mastra/core";
import { StudioSupabaseAuth } from "./server/studioAuth";
import { VercelDeployer } from "@mastra/deployer-vercel";
import { ConsoleLogger } from "./server/consoleLogger";
import { thom } from "./agents/thom";
import { queryFormulator } from "./agents/nynaeve/queryFormulator";
import { assessRiskAgent } from "./agents/nynaeve/assessRiskAgent";
import { ruleAgent } from "./agents/nynaeve/ruleAgent";
import { reviewDecisionWorkflow } from "./workflows/reviewDecision";
import { corsMiddleware } from "./server/cors";
import { createObservability } from "./server/observability";
import { appStateRoute } from "./server/routes/appState";
import { sessionResetRoute } from "./server/routes/sessionReset";
import { createStorage } from "./server/storage";
import { userSupabaseMiddleware } from "./server/userSupabaseMiddleware";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required (see .env.example)",
  );
}

const storage = await createStorage();

// Hoisted so the error-catching middleware below can route uncaught throws
// through the same logger as the rest of the app — Mastra's Hono integration
// doesn't `logger.error()` unhandled handler exceptions before returning 500,
// which would otherwise hide the failure in prod.
const logger = new ConsoleLogger({ name: "wheel-of-time", level: "info" });

export const mastra = new Mastra({
  agents: { thom, queryFormulator, assessRiskAgent, ruleAgent },
  workflows: { reviewDecision: reviewDecisionWorkflow },
  storage,
  logger,
  observability: createObservability(),
  // `mastra build` emits .vercel/output/ for deployment.
  // studio: false → deployer emits a catch-all route ({src: "/(.*)", dest: "/"})
  // that sends every request to the function, including /app/*. With studio:
  // true the deployer hardcodes /api/* and /health as the only function routes
  // and falls everything else through to a Studio SPA — which would 404 our
  // /app/state and /app/session/reset routes. Run `mastra studio` locally
  // pointed at the prod URL when needed. (Once /app/* moves to Supabase RPCs
  // / shared package, studio: true becomes safe — see CLAUDE.md follow-ups.)
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
    // StudioSupabaseAuth = MastraAuthSupabase (JWT verification for web-app
    // requests) + ICredentialsProvider.signIn (so Studio renders an
    // email/password login form). Sign-in is gated by STUDIO_ALLOWED_EMAILS;
    // web-app users go through the existing JWT path and bypass that
    // allowlist entirely. authorizeUser: () => true is the coarse "authed
    // user is past the door" gate — per-row scoping comes from RLS at
    // public.* tables and MASTRA_RESOURCE_ID_KEY (set by
    // userSupabaseMiddleware) at mastra.* tables.
    auth: new StudioSupabaseAuth({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_PUBLISHABLE_KEY,
      authorizeUser: () => true,
      protected: ["/api/*", "/app/*"],
    }),
    // Mastra wraps every route handler in its own try/catch before any
    // server.middleware runs, so an uncaught throw never reaches middleware
    // — it's funneled through this hook instead. Without onError, Mastra
    // returns a generic 500 with zero logging, which is the failure mode
    // that originally hid the 8949 catalog ENOENT in prod.
    onError: (err, c) => {
      logger.error("unhandled handler error", {
        method: c.req.method,
        path: c.req.path,
        err,
      });
      return c.json({ error: "internal server error" }, 500);
    },
    middleware: [
      // CORS so cross-origin preflights short-circuit before everything else.
      // Configured by ALLOWED_ORIGINS env var; permissive when unset.
      corsMiddleware,
      // Builds a per-request user-scoped Supabase client from the bearer JWT
      // and stashes it on requestContext + Hono context. Tools and routes
      // pull it via tools/userContext.ts and HONO_CONTEXT_KEYS respectively.
      userSupabaseMiddleware,
    ],
    apiRoutes: [appStateRoute, sessionResetRoute],
  },
});

