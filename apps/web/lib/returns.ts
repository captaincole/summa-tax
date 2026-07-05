// TaxReturn type + thread-id convention. The filings queries that used to
// live here (listOwnerReturns / getOwnerReturnByYear) moved to
// lib/serverDb.ts — they read the libsql app DB, which only exists
// server-side. This module stays client-safe because AppShell (a client
// component) imports threadIdFor + the TaxReturn type.
//
// The URL slug stays the year string (e.g. "2025") because each user has at
// most one filing per tax_year today; the agent's appState route also keys
// threads + draft lookups by year. Filing UUID is carried in the TaxReturn
// for callers that need it (e.g. resolving the share page).
//
// `realDataAvailable` is kept on the type because a handful of /r/* pages
// still branch on it. With the query-based world every TaxReturn is real,
// so the field is always `true`.

export type ReturnState = "active" | "filed";

export interface TaxReturn {
  id: string;
  year: number;
  filingId: string;
  label: string;
  state: ReturnState;
  realDataAvailable: boolean;
  status: string;
}

// Deterministic per-user + per-return thread ID. Must match the format used
// by /app/state in apps/agent (no shared package yet — keep these in sync).
// We key by year (not filing UUID) so a reset that wipes-and-recreates the
// filing keeps a stable conversational thread for the user.
export function threadIdFor(userId: string, returnId: string): string {
  return `${userId}::${returnId}`;
}
