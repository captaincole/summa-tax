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
// max: 5 — testing whether session-mode pooling (port 5432) is faster for
// Mastra's listMessages-style multi-statement reads. Transaction mode (6543)
// borrows a fresh PG connection per statement, which may add overhead for
// chatty operations. Revisit once we have data from the [pg] timing logs.
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
export async function createStorage(): Promise<MastraCompositeStore> {
  const pg = new PostgresStore({
    id: "wheel-of-time-storage",
    pool: pgPool,
    schemaName: "mastra",
  });
  const inMemory = new InMemoryStore({ id: "wheel-of-time-inmemory" });

  return new MastraCompositeStore({
    id: "wheel-of-time-composite",
    default: pg,
    domains: {
      observability: await inMemory.getStore("observability"),
    },
  });
}
