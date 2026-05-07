// One-shot migration script for Mastra's framework schema. Run this:
//   • Once before the first deploy (so tables exist when the runtime starts
//     with disableInit: true).
//   • Any time @mastra/core or @mastra/pg bumps to a version that adds
//     columns/tables (release notes will say if they did).
//
// Why it exists: at runtime we set `disableInit: true` on PostgresStore +
// MastraCompositeStore so cold starts don't pay the ~200-query CREATE
// TABLE / ALTER TABLE storm. This script does that migration explicitly,
// against whatever POSTGRES_URL is in the loaded .env file.
//
// Usage:
//   npm run migrate:mastra                  # uses .env.development by default
//   POSTGRES_URL=<prod-url> npm run migrate:mastra   # against prod
//
// Idempotent — Mastra's init uses CREATE TABLE IF NOT EXISTS / ALTER TABLE
// ADD COLUMN IF NOT EXISTS, so running it twice is safe.

import "dotenv/config";
import { PostgresStore } from "@mastra/pg";
import { Pool } from "pg";

async function main(): Promise<void> {
  if (!process.env.POSTGRES_URL) {
    console.error(
      "POSTGRES_URL is required. Set it in .env.development, or pass it inline:",
    );
    console.error("  POSTGRES_URL=postgres://... npm run migrate:mastra");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    max: 5,
  });

  const store = new PostgresStore({
    id: "wheel-of-time-migrate",
    pool,
    schemaName: "mastra",
    disableInit: false,
  });

  console.log(
    "[migrate] running Mastra storage migrations against POSTGRES_URL",
  );
  const start = Date.now();
  try {
    await store.init();
    console.log(`[migrate] done in ${Date.now() - start}ms`);
  } catch (err) {
    console.error("[migrate] FAILED:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] unexpected:", err);
  process.exit(1);
});
