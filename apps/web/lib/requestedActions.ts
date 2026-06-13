import type { SupabaseClient } from "@supabase/supabase-js";

// Mirrors public.requested_actions. RLS scopes reads/writes to the
// authenticated user; we never pass a user_id filter at the call site.
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

type Row = Record<string, unknown>;

export function rowToAction(row: Row): RequestedAction {
  return {
    id: row.id as string,
    taxYear: row.tax_year as number,
    kind: row.kind as RequestedActionKind,
    title: row.title as string,
    detail: (row.detail as string | null) ?? null,
    documentType: (row.document_type as string | null) ?? null,
    acceptPattern: (row.accept_pattern as string | null) ?? null,
    status: row.status as RequestedActionStatus,
    resolvedDocumentId: (row.resolved_document_id as string | null) ?? null,
    createdAt: row.created_at as string,
    resolvedAt: (row.resolved_at as string | null) ?? null,
  };
}

// "Open" in the UI sense — anything the user can still act on or that's
// in flight. Resolved/skipped/dismissed cards stay in the DB for audit
// but aren't surfaced.
export async function fetchOpenActions(
  supabase: SupabaseClient,
  taxYear: number,
): Promise<RequestedAction[]> {
  const { data, error } = await supabase
    .from("requested_actions")
    .select(
      "id, tax_year, kind, title, detail, document_type, accept_pattern, status, resolved_document_id, created_at, resolved_at",
    )
    .in("status", ["open", "processing"])
    .eq("tax_year", taxYear)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`requested actions: ${error.message}`);
  return (data ?? []).map(rowToAction);
}

// Called the moment the user's upload reaches Supabase Storage. The card
// stays visible (status='processing' shows a "Luca is reviewing this"
// indicator) until Luca calls dismiss-requested-action after ingesting.
export async function markActionProcessing(
  supabase: SupabaseClient,
  actionId: string,
  documentId: string,
): Promise<void> {
  const { error } = await supabase
    .from("requested_actions")
    .update({
      status: "processing",
      resolved_document_id: documentId,
    })
    .eq("id", actionId);
  if (error) throw new Error(`mark action processing: ${error.message}`);
}

export async function skipAction(
  supabase: SupabaseClient,
  actionId: string,
): Promise<void> {
  const { error } = await supabase
    .from("requested_actions")
    .update({
      status: "skipped",
      resolved_at: new Date().toISOString(),
    })
    .eq("id", actionId);
  if (error) throw new Error(`skip action: ${error.message}`);
}
