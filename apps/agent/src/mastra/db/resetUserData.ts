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
 * Wipe every user-data row in the database, preserving schemas (so callers
 * with cached references — Mastra Memory, our own modules — keep working
 * without restart) and any `ref_*` reference tables.
 *
 * We DELETE rows instead of DROP TABLE because Mastra Memory caches schema
 * state in-process: dropping `mastra_threads` mid-process leaves it querying
 * a table that no longer exists, breaking the next chat turn until restart.
 * DELETE FROM keeps the schema and just empties the rows.
 *
 * The `dropped` field name is preserved for caller compatibility — it now
 * means "tables we wiped" rather than "tables we dropped".
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
    await client.execute(`DELETE FROM "${name}"`);
    dropped.push(name);
  }

  return { dropped, preserved };
}
