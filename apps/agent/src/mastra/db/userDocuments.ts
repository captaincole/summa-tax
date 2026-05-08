import type { SupabaseClient } from "@supabase/supabase-js";

// Storage helper for user-owned documents (drafts, finals, uploads).
//
// Two stores work in tandem:
//   - public.user_documents (metadata) — what files exist, when, what kind.
//   - user-documents bucket (bytes) — the actual PDF/JSON/etc.
//
// Both layers enforce RLS via auth.uid(); supabase clients passed in here
// must be user-scoped (built per-request from the user's JWT). Service-role
// callers bypass RLS — only use them for admin operations like reset.
//
// Storage paths are `{userId}/{category}/{slug}-{ulid}.{ext}`. The ULID
// suffix avoids collisions when generate-tax-documents runs multiple times
// (each run creates new rows + new files; old chat-message links keep
// resolving to the version they were generated against).

const BUCKET = "user-documents";

export type Category = "drafts" | "finals" | "uploads";

export interface UserDocumentRow {
  id: string;
  userId: string;
  category: Category;
  scenario: string | null;
  filename: string;
  storagePath: string;
  sizeBytes: number | null;
  mimeType: string | null;
  expiresAt: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

interface UserDocumentDbRow {
  id: string;
  user_id: string;
  category: string;
  scenario: string | null;
  filename: string;
  storage_path: string;
  size_bytes: number | null;
  mime_type: string | null;
  expires_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

function rowToDocument(r: UserDocumentDbRow): UserDocumentRow {
  return {
    id: r.id,
    userId: r.user_id,
    category: r.category as Category,
    scenario: r.scenario,
    filename: r.filename,
    storagePath: r.storage_path,
    sizeBytes: r.size_bytes,
    mimeType: r.mime_type,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    metadata: r.metadata,
  };
}

// Crockford-base32 ULID generator (lexicographically sortable, no external dep).
// Time component is 48-bit ms; randomness is 80-bit. Good enough for filename
// disambiguation at our scale.
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(): string {
  const time = Date.now();
  let timeStr = "";
  let t = time;
  for (let i = 9; i >= 0; i--) {
    timeStr = ULID_ALPHABET[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  let randStr = "";
  for (let i = 0; i < 16; i++) {
    randStr += ULID_ALPHABET[Math.floor(Math.random() * 32)];
  }
  return timeStr + randStr;
}

function buildStoragePath(
  userId: string,
  category: Category,
  baseSlug: string,
  extension: string,
): string {
  const safeExt = extension.startsWith(".") ? extension.slice(1) : extension;
  return `${userId}/${category}/${baseSlug}-${ulid()}.${safeExt}`;
}

export interface CreateDocumentInput {
  userId: string;
  category: Category;
  scenario?: string | null;
  /** Display name shown in the UI / chat link (e.g., "Form 1040 — 2025"). */
  filename: string;
  /** Slug used in the storage filename (e.g., "1040-2025"). */
  storageSlug: string;
  extension: string;
  bytes: Buffer | Uint8Array;
  mimeType: string;
  expiresInDays?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateDocumentResult {
  id: string;
  storagePath: string;
}

// Upload bytes + insert metadata row in one operation. Returns the row's UUID
// so callers can build the public download path `/documents/{id}`.
//
// The bytes are uploaded BEFORE the row is inserted; if the row insert fails
// we end up with an orphan blob in storage (cheap, will get cleaned up by a
// future GC pass). The reverse ordering (insert first, then upload) leaves a
// row pointing at non-existent bytes which is worse — broken download links.
export async function createDocument(
  supabase: SupabaseClient,
  input: CreateDocumentInput,
): Promise<CreateDocumentResult> {
  const storagePath = buildStoragePath(
    input.userId,
    input.category,
    input.storageSlug,
    input.extension,
  );

  const upload = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: input.mimeType,
      upsert: false,
    });
  if (upload.error) {
    throw new Error(`createDocument upload failed: ${upload.error.message}`);
  }

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
    : null;

  const { data, error } = await supabase
    .from("user_documents")
    .insert({
      user_id: input.userId,
      category: input.category,
      scenario: input.scenario ?? null,
      filename: input.filename,
      storage_path: storagePath,
      size_bytes: input.bytes.byteLength,
      mime_type: input.mimeType,
      expires_at: expiresAt,
      metadata: input.metadata ?? null,
    })
    .select("id")
    .single();
  if (error) {
    throw new Error(`createDocument insert failed: ${error.message}`);
  }

  return { id: data.id as string, storagePath };
}

export interface ListDocumentsOpts {
  category?: Category;
  scenario?: string | null;
  /** Filter by metadata.formId — convenience for the "most recent 1040" query. */
  formId?: string;
  /** Filter by metadata.taxYear. */
  taxYear?: number;
  limit?: number;
}

export async function listDocuments(
  supabase: SupabaseClient,
  opts: ListDocumentsOpts = {},
): Promise<UserDocumentRow[]> {
  let q = supabase
    .from("user_documents")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(opts.limit ?? 100, 500));
  if (opts.category) q = q.eq("category", opts.category);
  if (opts.scenario !== undefined) {
    if (opts.scenario === null) q = q.is("scenario", null);
    else q = q.eq("scenario", opts.scenario);
  }
  if (opts.formId) q = q.eq("metadata->>formId", opts.formId);
  if (opts.taxYear !== undefined) {
    q = q.eq("metadata->>taxYear", String(opts.taxYear));
  }
  const { data, error } = await q;
  if (error) throw new Error(`listDocuments failed: ${error.message}`);
  return ((data ?? []) as UserDocumentDbRow[]).map(rowToDocument);
}

