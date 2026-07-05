// Requested-action types + browser-side fetchers. Domain data lives in the
// libsql app DB on the server; the browser goes through the
// /api/requested-actions Route Handlers (Supabase session cookie auth →
// lib/serverDb.ts queries).
//
// v1 only emits kind='upload'. The shape supports 'confirm' / 'decide'
// for when Luca learns to surface structured non-document asks.

export type RequestedActionKind = "upload" | "confirm" | "decide";
export type RequestedActionStatus =
  | "open"
  | "processing"
  | "resolved"
  | "skipped"
  | "dismissed";

export interface RequestedAction {
  id: string;
  taxYear: number;
  kind: RequestedActionKind;
  title: string;
  detail: string | null;
  documentType: string | null;
  acceptPattern: string | null;
  status: RequestedActionStatus;
  resolvedDocumentId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

// "Open" in the UI sense — anything the user can still act on or that's
// in flight. Resolved/skipped/dismissed cards stay in the DB for audit
// but aren't surfaced.
export async function fetchOpenActions(
  taxYear: number,
): Promise<RequestedAction[]> {
  const res = await fetch(`/api/requested-actions?year=${taxYear}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`requested actions: ${res.status}`);
  return (await res.json()) as RequestedAction[];
}

// Called the moment the user's upload lands. The card stays visible
// (status='processing' shows a "Luca is reviewing this" indicator) until
// Luca calls dismiss-requested-action after ingesting.
export async function markActionProcessing(
  actionId: string,
  documentId: string,
): Promise<void> {
  const res = await fetch(
    `/api/requested-actions/${encodeURIComponent(actionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "processing", documentId }),
    },
  );
  if (!res.ok) throw new Error(`mark action processing: ${res.status}`);
}

export async function skipAction(actionId: string): Promise<void> {
  const res = await fetch(
    `/api/requested-actions/${encodeURIComponent(actionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "skipped" }),
    },
  );
  if (!res.ok) throw new Error(`skip action: ${res.status}`);
}
