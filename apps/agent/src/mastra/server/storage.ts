import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { InMemoryStore, MastraCompositeStore } from "@mastra/core/storage";
import { LibSQLStore } from "@mastra/libsql";

// Mastra runtime storage (threads, messages, working memory, workflow
// snapshots) lives in a local libsql/SQLite file — the third and last
// database role to leave Postgres (after the corpus and the domain tables).
//
// This deleted a pile of Postgres-era machinery on purpose:
//   - disableInit + scripts/migrateMastra.ts — libsql init is a handful of
//     local CREATE TABLE IF NOT EXISTS statements, not a ~200-query storm
//     over a pooled network connection, so we just let Mastra run it.
//   - pgPool + the pooler-6543 sizing rules — no server, no connections.
//
// The file is separate from app.db (domain data): Mastra owns this schema
// and migrates it on version bumps; keeping it in its own file means a
// framework migration can never touch user data, and "wipe all chats"
// stays a file delete.
//
// Path resolution mirrors db/appDb.ts: MASTRA_DB_PATH env wins, else
// <apps/agent>/.data/mastra.db anchored to this module so cwd doesn't
// matter across `mastra dev` / scripts / prod.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url)); // …/src/mastra/server
const DEFAULT_DB_PATH = resolve(MODULE_DIR, "../../../.data/mastra.db");

export function mastraDbUrl(): string {
  const path = process.env.MASTRA_DB_PATH
    ? resolve(process.env.MASTRA_DB_PATH)
    : DEFAULT_DB_PATH;
  mkdirSync(dirname(path), { recursive: true });
  return `file:${path}`;
}

// Composite store: LibSQLStore for everything by default, InMemoryStore for
// the observability domain. InMemoryStore resets on restart — fine for the
// demo; revisit when we want persistent traces.
export async function createStorage(): Promise<MastraCompositeStore> {
  const libsql = new LibSQLStore({
    id: "summa-storage",
    url: mastraDbUrl(),
  });
  const inMemory = new InMemoryStore({ id: "summa-inmemory" });

  return new MastraCompositeStore({
    id: "summa-composite",
    default: libsql,
    domains: {
      observability: await inMemory.getStore("observability"),
    },
  });
}
