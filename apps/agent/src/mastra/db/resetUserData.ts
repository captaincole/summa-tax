import type { Pool } from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { thom } from "../agents/thom";

// Per-user data reset is the only reset path. The web "Reset session" button
// hits POST /app/session/reset, which calls resetCurrentUserData below. There
// is no wholesale-truncate path; for that, run TRUNCATE in the Supabase SQL
// editor (or against a local Supabase instance once we have one).
//
// Filings + filing_members are deliberately NOT wiped. Resetting the filing
// to a known-empty state (zero facts, decisions, questions, documents,
// requests) shouldn't terminate any CPA shares or force the owner to
// re-create the filing. The row + memberships persist; everything inside
// the filing gets cleared.

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
  const [facts, questions, decisions, documents, actions] = await Promise.all([
    supabase.from("tax_facts").delete().gte("created_at", SENTINEL),
    supabase.from("open_questions").delete().gte("created_at", SENTINEL),
    supabase.from("ai_decisions").delete().gte("created_at", SENTINEL),
    supabase.from("user_documents").delete().gte("created_at", SENTINEL),
    supabase.from("requested_actions").delete().gte("created_at", SENTINEL),
  ]);
  for (const r of [facts, questions, decisions, documents, actions]) {
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

  // Mastra memory cleanup goes through Memory.deleteThread() rather than
  // raw SQL — Mastra owns the cascade (messages, observational memory,
  // vector embeddings if semantic recall is enabled), and using the
  // documented API keeps us aligned with whatever they add to the
  // teardown path in future versions. We list this user's threads, then
  // delete each one.
  let mastraThreadsDeleted = 0;
  const memory = await thom.getMemory();
  if (memory) {
    const { threads } = await memory.listThreads({
      filter: { resourceId: userId },
      perPage: false,
    });
    await Promise.all(threads.map((t) => memory.deleteThread(t.id)));
    mastraThreadsDeleted = threads.length;
  }
  // pool param kept for future per-user state that lives outside Mastra's
  // own ownership (e.g. workflow snapshots or traces if those become
  // user-relevant).
  void pool;

  return {
    domainRowsDeleted:
      (facts.count ?? 0) +
      (questions.count ?? 0) +
      (decisions.count ?? 0) +
      (actions.count ?? 0),
    mastraThreadsDeleted,
    documentsDeleted: documents.count ?? 0,
  };
}

