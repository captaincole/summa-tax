import { InMemoryStore, MastraCompositeStore } from "@mastra/core/storage";
import { PostgresStore } from "@mastra/pg";
import { Pool } from "pg";

if (!process.env.POSTGRES_URL) {
  throw new Error(
    "POSTGRES_URL is required — set it to your Supabase Postgres connection string (see .env.example)",
  );
}

// Shared pg.Pool for Mastra's runtime tables and admin queries (resets).
// Passed to PostgresStore as `pool` rather than `connectionString` so PgStore
// won't close it on store.close() — we own the pool lifecycle.
//
// max: 5 — Supavisor (port 6543) handles real connection pooling for us, so
// our local pool just keeps a few warm sockets. 5 gives concurrent-request
// headroom under Vercel Fluid Compute concurrency.
export const pgPool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  max: 5,
});

// Patch pool.query to log SQL + duration for every call. Catches all queries
// Mastra issues via the shared pool (PostgresStore uses pool.query()), our
// admin code, and any tools touching pgPool directly. Doesn't catch queries
// run on a checked-out client (pool.connect()) — extend if those become
// load-bearing. Truncates SQL to 120 chars so long INSERT/UPDATE statements
// don't dominate the log line.
const origQuery = pgPool.query.bind(pgPool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(pgPool as any).query = async (...args: any[]) => {
  const start = Date.now();
  const sql =
    typeof args[0] === "string"
      ? args[0]
      : (args[0]?.text ?? "<unknown>");
  const short = sql.replace(/\s+/g, " ").slice(0, 120);
  try {
    const result = await origQuery(...args);
    console.log(`[pg] ${Date.now() - start}ms ${short}`);
    return result;
  } catch (err) {
    console.log(`[pg] ${Date.now() - start}ms ERR ${short}`);
    throw err;
  }
};

// Composite store: PostgresStore (Supabase) for everything by default,
// InMemoryStore for the observability domain. InMemoryStore resets on restart
// — fine for the demo; revisit when we want persistent traces.
//
// disableInit: true on both layers skips the ~200-query schema migration
// storm Mastra runs on first storage access (CREATE TABLE / ALTER TABLE
// across ~14 sub-stores). On serverless, that storm fired on every cold
// start and pushed the first /messages request to ~10–14s. With it off,
// runtime queries assume the schema is already correct.
//
// Schema is kept in sync via `npm run migrate:mastra` — a standalone script
// that constructs a non-disabled storage and runs init() once. Run it before
// the first deploy and any time we bump @mastra/* to a version that adds
// schema. See scripts/migrateMastra.ts.
export async function createStorage(): Promise<MastraCompositeStore> {
  const pg = new PostgresStore({
    id: "wheel-of-time-storage",
    pool: pgPool,
    schemaName: "mastra",
    disableInit: true,
  });
  const inMemory = new InMemoryStore({ id: "wheel-of-time-inmemory" });

  return new MastraCompositeStore({
    id: "wheel-of-time-composite",
    default: pg,
    domains: {
      observability: await inMemory.getStore("observability"),
    },
    disableInit: true,
  });
}
