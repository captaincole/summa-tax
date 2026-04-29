import "dotenv/config";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { Mastra } from "@mastra/core";
import { registerApiRoute, SimpleAuth } from "@mastra/core/server";
import { InMemoryStore, MastraCompositeStore } from "@mastra/core/storage";
import { LibSQLStore } from "@mastra/libsql";
import { PinoLogger } from "@mastra/loggers";
import {
  Observability,
  ConsoleExporter,
  DefaultExporter,
} from "@mastra/observability";
import { thom } from "./agents/thom";
import { nynaeve } from "./agents/nynaeve";
import { resetUserData } from "./db/resetUserData";
import { cleanGeneratedFiles } from "./fs/cleanGeneratedFiles";
import { getCaseState } from "./tools/caseState";
import { listFactsByKeys } from "./db/taxFacts";

// Single demo session — all writes/reads scope to these constants. When we
// add per-visitor partitioning later, derive these from the authed user.
const DEMO_TAXPAYER_ID = "demo-session";
const DEMO_TAX_YEAR = 2025;

// SimpleAuth treats the env var as a bearer token. Frontend sends
// `Authorization: Bearer <DEMO_PASSCODE>` on every request. Mastra protects
// /api/agents/*, /api/workflows/*, and any custom routes we register.
//
// The "passcode" is the token value verbatim. Not rotation-safe; this is the
// demo posture. Production swap-out path is JWT or an external IDP.
const demoPasscode = process.env.DEMO_PASSCODE;
const demoAuth = demoPasscode
  ? new SimpleAuth<{ id: string }>({
      tokens: { [demoPasscode]: { id: "demo" } },
    })
  : undefined;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DRAFTS_DIR = process.env.DRAFTS_DIR
  ? resolve(process.env.DRAFTS_DIR)
  : resolve(projectRoot, "src/mastra/public/drafts");
mkdirSync(DRAFTS_DIR, { recursive: true });

// Built React app — Vite emits to web/dist/. Resolved relative to projectRoot
// so it works both in dev (running from source) and in prod (running from
// .mastra/output/, where ../../web/dist still resolves correctly because
// Render keeps the whole workspace at runtime).
const WEB_DIST_DIR = resolve(projectRoot, "web/dist");

// Paths owned by Mastra (API, custom user routes, Studio, system endpoints).
// Our static-frontend middleware falls through for these so the rest of the
// stack can handle them; everything else gets the React app.
const BACKEND_PREFIXES = [
  "/api",
  "/app",
  "/drafts",
  "/health",
  "/studio",
  "/swagger-ui",
  "/openapi.json",
];

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function contentTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  const ext = dot === -1 ? "" : filePath.slice(dot).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function readSafe(filePath: string): Buffer | null {
  if (!filePath.startsWith(WEB_DIST_DIR)) return null;
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath);
}

const dbUrl = process.env.DATABASE_URL ?? "file:./wheel-of-time.db";

// RESET_USER_DATA_ON_START=1 → wipe all non-ref_* tables before storage
// init. Intended for ephemeral deploys (dev redeploys, CI) where we want a
// clean slate each boot while preserving any curated reference tables.
if (process.env.RESET_USER_DATA_ON_START) {
  const resetClient = createClient({ url: dbUrl });
  const { dropped, preserved } = await resetUserData(resetClient);
  resetClient.close();
  const { deleted } = cleanGeneratedFiles();
  console.log(
    `[reset-on-start] dropped ${dropped.length} user tables, preserved ${preserved.length} ref tables (${preserved.join(", ") || "none"}), wiped ${deleted.length} generated files`,
  );
}

const libsql = new LibSQLStore({
  id: "wheel-of-time-storage",
  url: dbUrl,
});

// InMemoryStore resets on restart — fine for local dev; swap for DuckDB/Postgres
// when we need persistent observability.
const inMemory = new InMemoryStore({ id: "wheel-of-time-inmemory" });

const storage = new MastraCompositeStore({
  id: "wheel-of-time-composite",
  default: libsql,
  domains: {
    observability: await inMemory.getStore("observability"),
  },
});

export const mastra = new Mastra({
  agents: { thom, nynaeve },
  storage,
  logger: new PinoLogger({ name: "wheel-of-time", level: "info" }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "wheel-of-time",
        exporters: [new ConsoleExporter(), new DefaultExporter()],
      },
    },
  }),
  server: {
    auth: demoAuth,
    // Mount Studio at /studio so it doesn't claim the URL root and /assets/*,
    // which we need for the React app. Studio's catch-all only fires for
    // paths under studioBase, so /assets/foo.js routes to the SPA.
    studioBase: "/studio",
    middleware: [
      {
        path: "*",
        handler: async (c, next) => {
          if (c.req.method !== "GET") return next();
          const reqPath = c.req.path;
          if (
            BACKEND_PREFIXES.some(
              (p) => reqPath === p || reqPath.startsWith(`${p}/`),
            )
          ) {
            return next();
          }
          const rel = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
          const direct = readSafe(resolve(WEB_DIST_DIR, rel));
          if (direct) {
            return new Response(direct, {
              status: 200,
              headers: { "Content-Type": contentTypeFor(rel) },
            });
          }
          // SPA fallback — any unmatched non-asset path returns index.html so
          // React Router can resolve client-side. Asset misses (paths that
          // contain a dot) 404 cleanly instead of returning HTML.
          if (rel.includes(".")) {
            return c.notFound();
          }
          const indexHtml = readSafe(resolve(WEB_DIST_DIR, "index.html"));
          if (!indexHtml) return next();
          return new Response(indexHtml, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        },
      },
    ],
    apiRoutes: [
      // Live status for the right rail — open asks, progress, draft URL.
      registerApiRoute("/app/state", {
        method: "GET",
        handler: async (c) => {
          const result = await (
            getCaseState as unknown as {
              execute: (input: { taxpayerId: string; year: number }) => Promise<{
                openAsks: { factKey: string; prompt: string; origin: string; stage: string }[];
                progress: { intakePct: number; scopingPct: number; docsPct: number; overallPct: number };
                withinMvp: boolean;
                mvpViolations: string[];
                factCount: number;
                aiDecisions: unknown[];
                money: {
                  totalWages: number;
                  agi: number;
                  taxableIncome: number;
                  federalTaxOwed: number;
                  federalWithholding: number;
                  refundOrBalance: unknown;
                };
              }>;
            }
          ).execute({ taxpayerId: DEMO_TAXPAYER_ID, year: DEMO_TAX_YEAR });

          const draftFilename = `1040-${DEMO_TAXPAYER_ID}-${DEMO_TAX_YEAR}.pdf`;
          const draftPath = resolve(DRAFTS_DIR, draftFilename);
          const draftUrl = existsSync(draftPath) ? `/drafts/${draftFilename}` : null;

          // Pull the first-name fact for the header greeting. Listed DESC by
          // created_at, so [0] is the most recent (handles a name correction).
          const nameRows = await listFactsByKeys(
            DEMO_TAXPAYER_ID,
            DEMO_TAX_YEAR,
            ["identity.name.first"],
          );
          const taxpayerFirstName =
            nameRows.length > 0 && typeof nameRows[0].value === "string"
              ? (nameRows[0].value as string)
              : null;

          return c.json({
            withinMvp: result.withinMvp,
            mvpViolations: result.mvpViolations,
            openAsks: result.openAsks,
            progress: result.progress,
            money: result.money,
            factCount: result.factCount,
            decisionCount: result.aiDecisions.length,
            draftUrl,
            taxpayerFirstName,
          });
        },
      }),

      // Wipes user data + draft files. Mastra and our db modules will
      // recreate their schemas on next use.
      registerApiRoute("/app/session/reset", {
        method: "POST",
        handler: async (c) => {
          const resetClient = createClient({ url: dbUrl });
          const { dropped, preserved } = await resetUserData(resetClient);
          resetClient.close();
          const { deleted } = cleanGeneratedFiles();
          return c.json({
            ok: true,
            droppedTables: dropped.length,
            preservedTables: preserved.length,
            deletedFiles: deleted.length,
          });
        },
      }),

      // Serves generated draft PDFs. Mastra's dev server doesn't auto-serve
      // src/mastra/public/*, so we route /drafts/:filename → disk manually.
      // Public so <a href> clicks and iframe embeds work without an Authorization
      // header — filenames are hard-to-guess and the demo is behind a passcode
      // gate at the app level. Revisit if drafts ever contain real PII.
      registerApiRoute("/drafts/:filename", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          const filename = basename(c.req.param("filename"));
          if (!filename.endsWith(".pdf")) {
            return c.json({ error: "Only .pdf files are served" }, 400);
          }
          const path = resolve(DRAFTS_DIR, filename);
          if (!path.startsWith(DRAFTS_DIR) || !existsSync(path)) {
            return c.json({ error: "Not found" }, 404);
          }
          const bytes = readFileSync(path);
          return c.body(bytes, 200, {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${filename}"`,
          });
        },
      }),
    ],
  },
});
