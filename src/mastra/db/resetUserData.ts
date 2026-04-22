import type { Client } from "@libsql/client";

// Tables whose names start with these prefixes are preserved across resets.
// By convention:
//   - `ref_*`     → curated reference data (tax authorities, form metadata,
//                   regulation text). Expensive to rebuild; survives resets.
//   - `sqlite_*`  → SQLite internal tables (sqlite_sequence, sqlite_stat1).
//                   Never drop these — SQLite owns them.
const PRESERVED_PREFIXES = ["ref_", "sqlite_"] as const;

export interface ResetResult {
  dropped: string[];
  preserved: string[];
}

/**
 * Drop every user-data table in the database, preserving any `ref_*`
 * reference tables and SQLite internals. Schema is NOT recreated — callers
 * that need tables back (Mastra runtime, our own db modules) recreate them
 * via their own `ensureSchema` logic on next use.
 */
export async function resetUserData(client: Client): Promise<ResetResult> {
  const result = await client.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table'`,
  );
  const allTables = result.rows.map((r) => String(r.name));

  const dropped: string[] = [];
  const preserved: string[] = [];

  for (const name of allTables) {
    const isPreserved = PRESERVED_PREFIXES.some((p) => name.startsWith(p));
    if (isPreserved) {
      preserved.push(name);
      continue;
    }
    // Identifiers from sqlite_master are already-existing table names, so
    // interpolating is safe here (no user input). Quote defensively anyway.
    await client.execute(`DROP TABLE IF EXISTS "${name}"`);
    dropped.push(name);
  }

  return { dropped, preserved };
}
