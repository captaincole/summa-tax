import type { Pool } from "pg";

const SCHEMA_NAME = "mastra";

export interface ResetResult {
  truncated: string[];
}

// Wipe every row from every table in the `mastra` schema. Used by the boot
// reset hook (RESET_USER_DATA_ON_START) and the /app/session/reset route to
// clear Mastra's runtime state — threads, messages, traces, working memory —
// without dropping the schema. Keeping schemas intact lets PgStore's cached
// references stay valid; truncated tables are just empty tables.
//
// Returns an empty truncated[] on first boot when Mastra hasn't created any
// tables yet — pg_tables comes back empty, no truncates run, no error.
export async function resetMastraSchema(pool: Pool): Promise<ResetResult> {
  const tables = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
    [SCHEMA_NAME],
  );
  const names = tables.rows.map((r) => r.tablename);
  if (names.length === 0) return { truncated: [] };

  // TRUNCATE all tables in one statement so CASCADE handles inter-table FKs
  // (mastra_messages → mastra_threads, etc.) without manual ordering. Names
  // come from pg_tables (existing tables), but quote defensively anyway.
  const list = names.map((n) => `mastra."${n}"`).join(", ");
  await pool.query(`TRUNCATE ${list} CASCADE`);

  return { truncated: names };
}
