import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PerUserResetResult {
  domainRowsDeleted: number;
  mastraThreadsDeleted: number;
}

// Per-user data reset, used by /app/session/reset. Deletes only the calling
// user's data — both their public.* domain rows (RLS scopes naturally via the
// user-scoped Supabase client) and the mastra.* threads owned by their
// resourceId (admin pool, scoped by parameter — Mastra's framework tables
// don't have RLS on, so we filter explicitly).
//
// mastra_messages, mastra_resources, mastra_observational_memory, etc. either
// FK-cascade off mastra_threads or live under the same resourceId. The thread
// delete + cascade is the cleanest single-statement scope.
export async function resetCurrentUserData(
  supabase: SupabaseClient,
  pool: Pool,
  userId: string,
): Promise<PerUserResetResult> {
  // Domain tables — RLS scopes to auth.uid() automatically. Returning the
  // count is best-effort; on RLS-blocked rows it'd return 0.
  const [facts, questions, decisions] = await Promise.all([
    supabase.from("tax_facts").delete().neq("id", ""),
    supabase.from("open_questions").delete().neq("id", ""),
    supabase.from("ai_decisions").delete().neq("id", ""),
  ]);
  for (const r of [facts, questions, decisions]) {
    if (r.error) throw new Error(`reset domain delete failed: ${r.error.message}`);
  }

  // Mastra threads (and via cascade their messages, observational memory, …)
  // for this user's resourceId.
  const threads = await pool.query(
    `DELETE FROM mastra.mastra_threads WHERE "resourceId" = $1`,
    [userId],
  );
  // Resources are a sibling table, not FK-linked to threads — clear those too.
  await pool.query(
    `DELETE FROM mastra.mastra_resources WHERE id = $1`,
    [userId],
  );

  return {
    domainRowsDeleted:
      (facts.count ?? 0) + (questions.count ?? 0) + (decisions.count ?? 0),
    mastraThreadsDeleted: threads.rowCount ?? 0,
  };
}

export interface FullResetResult {
  truncated: string[];
}

// Full wipe across all users — only used by RESET_USER_DATA_ON_START at boot,
// for ephemeral deploy redeployments / CI. Requires admin pool (postgres
// superuser) to bypass RLS via TRUNCATE.
export async function resetAllUserData(pool: Pool): Promise<FullResetResult> {
  const mastraTables = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
    ["mastra"],
  );
  const mastraQualified = mastraTables.rows.map(
    (r) => `mastra."${r.tablename}"`,
  );
  const domainQualified = [
    `public."tax_facts"`,
    `public."open_questions"`,
    `public."ai_decisions"`,
  ];
  const all = [...mastraQualified, ...domainQualified];
  if (all.length === 0) return { truncated: [] };

  await pool.query(`TRUNCATE ${all.join(", ")} CASCADE`);
  return {
    truncated: [
      ...mastraTables.rows.map((r) => `mastra.${r.tablename}`),
      "public.tax_facts",
      "public.open_questions",
      "public.ai_decisions",
    ],
  };
}
