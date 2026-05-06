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
// max: 2 because Supavisor (port 6543) is already the real connection pool —
// our local pool just keeps a warm socket per process to avoid reconnect cost.
// One slot is enough; the second hedges against contention when a serverless
// instance handles concurrent requests under Vercel Fluid Compute.
export const pgPool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  max: 2,
});

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
