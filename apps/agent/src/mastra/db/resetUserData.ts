import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PerUserResetResult {
  domainRowsDeleted: number;
  mastraThreadsDeleted: number;
  documentsDeleted: number;
}

// Per-user data reset, used by /app/session/reset. Deletes only the calling
// user's data — domain rows + Mastra threads + documents (both metadata rows
// and storage objects). RLS scopes the user-scoped supabase client; the
// mastra.* delete uses the admin pool with explicit resourceId because
// framework tables don't carry RLS.
export async function resetCurrentUserData(
  supabase: SupabaseClient,
  pool: Pool,
  userId: string,
): Promise<PerUserResetResult> {
  // Capture document storage paths BEFORE deleting rows — once the rows are
  // gone we lose the pointers to the bytes in storage and would orphan them.
  const docPathsResult = await supabase
    .from("user_documents")
    .select("storage_path");
  if (docPathsResult.error) {
    throw new Error(
      `reset document list failed: ${docPathsResult.error.message}`,
    );
  }
  const storagePaths = (docPathsResult.data ?? []).map(
    (r) => r.storage_path as string,
  );

  // Domain + document tables — RLS scopes to auth.uid() automatically. The
  // `.gte("created_at", "1970-01-01")` filter is a universal-true predicate
  // that works regardless of the id column's type (text vs uuid); it's
  // PostgREST's "delete all matching rows" idiom — DELETE without any
  // filter is rejected at the API layer.
  const SENTINEL = "1970-01-01";
  const [facts, questions, decisions, documents] = await Promise.all([
    supabase.from("tax_facts").delete().gte("created_at", SENTINEL),
    supabase.from("open_questions").delete().gte("created_at", SENTINEL),
    supabase.from("ai_decisions").delete().gte("created_at", SENTINEL),
    supabase.from("user_documents").delete().gte("created_at", SENTINEL),
  ]);
  for (const r of [facts, questions, decisions, documents]) {
    if (r.error) throw new Error(`reset delete failed: ${r.error.message}`);
  }

  // Storage objects matching the rows we just deleted. RLS on storage.objects
  // scopes by folder == user's id, so this only reaches their own files.
  if (storagePaths.length > 0) {
    const removal = await supabase.storage
      .from("user-documents")
      .remove(storagePaths);
    if (removal.error) {
      throw new Error(`reset storage remove failed: ${removal.error.message}`);
    }
  }

  // Mastra threads (and via cascade their messages, observational memory, …)
  // for this user's resourceId.
  const threads = await pool.query(
    `DELETE FROM mastra.mastra_threads WHERE "resourceId" = $1`,
    [userId],
  );
  // Resources are a sibling table, not FK-linked to threads — clear those too.
  await pool.query(`DELETE FROM mastra.mastra_resources WHERE id = $1`, [
    userId,
  ]);

  return {
    domainRowsDeleted:
      (facts.count ?? 0) + (questions.count ?? 0) + (decisions.count ?? 0),
    mastraThreadsDeleted: threads.rowCount ?? 0,
    documentsDeleted: documents.count ?? 0,
  };
}

export interface FullResetResult {
  truncated: string[];
}

// Full wipe across all users — only used by RESET_USER_DATA_ON_START at boot,
// for ephemeral deploy redeployments / CI. Truncates Mastra runtime, domain
// tables, and the user_documents metadata. Storage objects are NOT cleared
// (the bucket can hold orphans across reboots) — accept this cost for the
// dev-convenience flag; a periodic cleanup job is the right home for that.
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
    `public."user_documents"`,
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
      "public.user_documents",
    ],
  };
}
