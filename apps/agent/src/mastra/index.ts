import "dotenv/config";
import { Mastra } from "@mastra/core";
import { VercelDeployer } from "@mastra/deployer-vercel";
import { ConsoleLogger } from "./server/consoleLogger";
import { luca } from "./agents/luca";
import { reviewDecisionWorkflow } from "./workflows/reviewDecision";
import { corsMiddleware } from "./server/cors";
import { createObservability } from "./server/observability";
import { appStateRoute } from "./server/routes/appState";
import { cpaFilingStateRoute } from "./server/routes/cpaFilingState";
import { createFilingRoute } from "./server/routes/createFiling";
import { deleteFilingRoute } from "./server/routes/deleteFiling";
import { inviteCpaRoute } from "./server/routes/inviteCpa";
import { sessionResetRoute } from "./server/routes/sessionReset";
import { createStorage } from "./server/storage";
import { ownerMiddleware } from "./server/ownerMiddleware";

const storage = await createStorage();

// Hoisted so the error-catching middleware below can route uncaught throws
// through the same logger as the rest of the app — Mastra's Hono integration
// doesn't `logger.error()` unhandled handler exceptions before returning 500,
// which would otherwise hide the failure in prod.
const logger = new ConsoleLogger({ name: "summa", level: "info" });

export const mastra = new Mastra({
  // The app has exactly ONE agent. The review-decision judges are workflow
  // internals (workflows/reviewDecision/judges/) and deliberately NOT
  // registered — registering them would expose them as chattable agents in
  // Studio and the public API.
  agents: { luca },
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
  // maxDuration: 300 = Pro default; revisit if a Luca turn ever exceeds 60s,
  // at which point we move the grounding review to a background queue rather than raise it.
  // sfo1 keeps the function in the same region as Supabase US-West.
  deployer: new VercelDeployer({
    studio: false,
    maxDuration: 300,
    memory: 1536,
    regions: ["sfo1"],
  }),
  server: {
    // Single-user model: no per-request auth provider. The web app fronts
    // the agent (session cookie + server-side proxy); ownerMiddleware
    // resolves the instance owner and optionally enforces AGENT_API_TOKEN
    // for deployments where this port is reachable beyond localhost.
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
      // Optional AGENT_API_TOKEN gate + resolves the instance owner onto
      // requestContext (resource id for memory scoping, email for the
      // engine's authEmail enrichment).
      ownerMiddleware,
    ],
    apiRoutes: [
      appStateRoute,
      cpaFilingStateRoute,
      createFilingRoute,
      deleteFilingRoute,
      inviteCpaRoute,
      sessionResetRoute,
    ],
  },
});

