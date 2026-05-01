import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { createClient } from "@libsql/client";
import { Mastra } from "@mastra/core";
import { registerApiRoute } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";
import { thom } from "./agents/thom";
import { nynaeve } from "./agents/nynaeve";
import { resetUserData } from "./db/resetUserData";
import { cleanGeneratedFiles } from "./fs/cleanGeneratedFiles";
import { getCaseState } from "./tools/caseState";
import { getActiveTaxpayerId, listFacts, listFactsByKeys } from "./db/taxFacts";
import { listDecisions } from "./db/aiDecisions";
import { projectRoot } from "./paths";
import { DRAFTS_DIR } from "./fs/draftsDir";
import { createDemoAuth } from "./server/auth";
import { createObservability } from "./server/observability";
import { createStorage, dbUrl } from "./server/storage";

// Built React app (Vite emits to web/dist). Resolved relative to projectRoot
// so dev (running from source) and prod (running from .mastra/output/) agree.
// Moves to server/staticFrontend.ts when we extract that middleware.
const WEB_DIST_DIR = resolve(projectRoot, "web/dist");

// Single demo session — all writes/reads scope to these constants. When we
// add per-visitor partitioning later, derive these from the authed user.
const DEMO_TAXPAYER_ID = "demo-session";
const DEMO_TAX_YEAR = 2025;

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

const storage = await createStorage();

export const mastra = new Mastra({
  agents: { thom, nynaeve },
  storage,
  logger: new PinoLogger({ name: "wheel-of-time", level: "info" }),
  observability: createObservability(),
  server: {
    auth: createDemoAuth(),
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
          // Thom picks his own taxpayer_id (see his prompt) so the server has
          // to discover the active session at request time. Falls back to the
          // demo constant when the DB is empty so first-turn renders still work.
          const activeId =
            (await getActiveTaxpayerId(DEMO_TAX_YEAR)) ?? DEMO_TAXPAYER_ID;

          const result = await (
            getCaseState as unknown as {
              execute: (input: { taxpayerId: string; year: number }) => Promise<{
                forms: Array<{
                  formId: string;
                  mustFile: { ok: boolean; value?: boolean };
                  blockedLineCount: number;
                  blockers: Array<{ missingDecisionKey: string | null; missingFactKeys: string[] | null }>;
                }>;
                pendingDecisions: string[];
                pendingFacts: string[];
                money: {
                  totalWages: number;
                  federalAgi: number;
                  federalTaxableIncome: number;
                  federalTax: number;
                  federalWithholding: number;
                  federalRefund: number;
                  federalOwed: number;
                  stateTax: number;
                  stateWithholding: number;
                  stateRefund: number;
                  stateOwed: number;
                };
                factCount: number;
                aiDecisions: unknown[];
              }>;
            }
          ).execute({ taxpayerId: activeId, year: DEMO_TAX_YEAR });

          const draftFilename = `1040-${activeId}-${DEMO_TAX_YEAR}.pdf`;
          const draftPath = resolve(DRAFTS_DIR, draftFilename);
          const draftUrl = existsSync(draftPath) ? `/drafts/${draftFilename}` : null;

          // Other federal-form PDFs the engine produces. CA 540 PDF is
          // pending field-mapping work — still null for now.
          const form8949Filename = `8949-${activeId}-${DEMO_TAX_YEAR}.pdf`;
          const form8949Url = existsSync(resolve(DRAFTS_DIR, form8949Filename))
            ? `/drafts/${form8949Filename}`
            : null;
          const scheduleDFilename = `schedule-d-${activeId}-${DEMO_TAX_YEAR}.pdf`;
          const scheduleDUrl = existsSync(resolve(DRAFTS_DIR, scheduleDFilename))
            ? `/drafts/${scheduleDFilename}`
            : null;
          const form540Filename = `540-${activeId}-${DEMO_TAX_YEAR}.pdf`;
          const form540Url = existsSync(resolve(DRAFTS_DIR, form540Filename))
            ? `/drafts/${form540Filename}`
            : null;
          const sidecarFilename = `forms-${activeId}-${DEMO_TAX_YEAR}.json`;
          const sidecarUrl = existsSync(resolve(DRAFTS_DIR, sidecarFilename))
            ? `/drafts/${sidecarFilename}`
            : null;

          // Pull the first-name fact for the header greeting.
          const nameRows = await listFactsByKeys(
            activeId,
            DEMO_TAX_YEAR,
            ["identity.name.first"],
          );
          const taxpayerFirstName =
            nameRows.length > 0 && typeof nameRows[0].value === "string"
              ? (nameRows[0].value as string)
              : null;

          // Adapter: bridge new caseState shape back to the legacy fields the
          // current Layout/Activity UI consumes. When we update the UI to read
          // forms[] directly, this collapses.
          const openAsks = result.pendingDecisions.map((d) => ({
            factKey: d,
            prompt: `Need decision: ${d}`,
            origin: "form-engine",
            stage: "decisions",
          }));
          const totalForms = result.forms.length;
          const computedForms = result.forms.filter(
            (f) => f.mustFile.ok && (f.mustFile.value === false || f.blockedLineCount === 0),
          ).length;
          const overallPct = totalForms > 0
            ? Math.round((computedForms / totalForms) * 100)
            : 0;
          const progress = {
            intakePct: overallPct,
            scopingPct: overallPct,
            docsPct: overallPct,
            overallPct,
          };
          const refundOrBalance = result.money.federalRefund > 0
            ? { direction: "refund", amount: result.money.federalRefund }
            : result.money.federalOwed > 0
              ? { direction: "balance_due", amount: result.money.federalOwed }
              : null;
          const moneyLegacy = {
            totalWages: result.money.totalWages,
            agi: result.money.federalAgi,
            taxableIncome: result.money.federalTaxableIncome,
            federalTaxOwed: result.money.federalTax,
            federalWithholding: result.money.federalWithholding,
            refundOrBalance,
          };

          return c.json({
            withinMvp: true,
            mvpViolations: [] as string[],
            openAsks,
            progress,
            money: moneyLegacy,
            factCount: result.factCount,
            decisionCount: result.aiDecisions.length,
            draftUrl,
            form8949Url,
            scheduleDUrl,
            form540Url,
            sidecarUrl,
            taxpayerFirstName,
          });
        },
      }),

      // Merged activity feed for the right rail — tax_facts + ai_decisions
      // newest-first, formatted for the UI. Append-only across both tables,
      // so no dedup; the case engine handles latest-value collapsing elsewhere.
      registerApiRoute("/app/activity", {
        method: "GET",
        handler: async (c) => {
          const limitParam = c.req.query("limit");
          const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

          const activeId =
            (await getActiveTaxpayerId(DEMO_TAX_YEAR)) ?? DEMO_TAXPAYER_ID;

          const [facts, decisions] = await Promise.all([
            listFacts({ taxpayerId: activeId, year: DEMO_TAX_YEAR, limit }),
            listDecisions({ taxpayerId: activeId, year: DEMO_TAX_YEAR, limit }),
          ]);

          const factItems = facts.map((f) => ({
            kind: "fact" as const,
            id: f.id,
            createdAt: f.createdAt,
            title: f.key,
            category: f.category,
            value: f.value,
            sourceNote: f.sourceNote,
          }));

          const decisionItems = decisions.map((d) => ({
            kind: "decision" as const,
            id: d.id,
            createdAt: d.createdAt,
            title: d.decisionKey,
            value: d.decision,
            rationale: d.rationale,
            supportingFactKeys: d.supportingFactKeys,
            confidence: d.confidence,
            verdict: d.verdict,
            verdictReason: d.verdictReason,
            sourceNote: d.sourceNote,
          }));

          const items = [...factItems, ...decisionItems]
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
            .slice(0, limit);

          return c.json({ items });
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
