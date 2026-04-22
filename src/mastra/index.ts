import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createClient } from "@libsql/client";
import { Mastra } from "@mastra/core";
import { registerApiRoute } from "@mastra/core/server";
import { InMemoryStore, MastraCompositeStore } from "@mastra/core/storage";
import { LibSQLStore } from "@mastra/libsql";
import { PinoLogger } from "@mastra/loggers";
import {
  Observability,
  ConsoleExporter,
  DefaultExporter,
} from "@mastra/observability";
import { thom } from "./agents/thom";
import { resetUserData } from "./db/resetUserData";
import { cleanGeneratedFiles } from "./fs/cleanGeneratedFiles";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DRAFTS_DIR = resolve(projectRoot, "src/mastra/public/drafts");

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
  agents: { thom },
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
    apiRoutes: [
      // Serves generated draft PDFs. Mastra's dev server doesn't auto-serve
      // src/mastra/public/*, so we route /drafts/:filename → disk manually.
      registerApiRoute("/drafts/:filename", {
        method: "GET",
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
