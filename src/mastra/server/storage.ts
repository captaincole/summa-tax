import { InMemoryStore, MastraCompositeStore } from "@mastra/core/storage";
import { LibSQLStore } from "@mastra/libsql";

export const dbUrl = process.env.DATABASE_URL ?? "file:./wheel-of-time.db";

// Composite store: libsql for everything by default, InMemoryStore for the
// observability domain. InMemoryStore resets on restart — fine for local dev;
// swap for DuckDB/Postgres when we need persistent observability.
export async function createStorage(): Promise<MastraCompositeStore> {
  const libsql = new LibSQLStore({ id: "wheel-of-time-storage", url: dbUrl });
  const inMemory = new InMemoryStore({ id: "wheel-of-time-inmemory" });

  return new MastraCompositeStore({
    id: "wheel-of-time-composite",
    default: libsql,
    domains: {
      observability: await inMemory.getStore("observability"),
    },
  });
}
