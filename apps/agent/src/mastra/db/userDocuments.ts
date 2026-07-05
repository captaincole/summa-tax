import type { InValue, Row } from "@libsql/client";
import { getServiceRoleClient } from "./supabase";
import {
  getAppDb,
  ensureAppSchema,
  type Scope,
  asStr,
  asStrOrNull,
  asNumOrNull,
  asJson,
  nowIso,
} from "./appDb";

// Storage helper for user-owned documents (drafts, finals, uploads).
//
// Two stores work in tandem:
//   - user_documents (metadata, libsql app.db) — what files exist, when, what kind.
//   - user-documents bucket (bytes, Supabase Storage) — the actual PDF/JSON/etc.
//     Blobs move to the local filesystem in Phase 1 step 4. Until then the
//     upload goes through the SERVICE-ROLE client: the bucket's RLS policies
//     reference public.filing_members, which is empty now that memberships
//     live in libsql — user-JWT storage calls are denied. Callers must have
//     verified the user's filing access (requireUserContext) before calling.
//
// Storage paths are `{filingId}/{category}/{slug}-{ulid}.{ext}`. The ULID
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

function rowToDocument(r: Row): UserDocumentRow {
  return {
    id: asStr(r.id),
    userId: asStr(r.user_id),
    category: asStr(r.category) as Category,
    scenario: asStrOrNull(r.scenario),
    filename: asStr(r.filename),
    storagePath: asStr(r.storage_path),
    sizeBytes: asNumOrNull(r.size_bytes),
    mimeType: asStrOrNull(r.mime_type),
    expiresAt: asStrOrNull(r.expires_at),
    createdAt: asStr(r.created_at),
    metadata: asJson(r.metadata) as Record<string, unknown> | null,
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
  filingId: string,
  category: Category,
  baseSlug: string,
  extension: string,
): string {
  const safeExt = extension.startsWith(".") ? extension.slice(1) : extension;
  return `${filingId}/${category}/${baseSlug}-${ulid()}.${safeExt}`;
}

export interface CreateDocumentInput {
  userId: string;
  filingId: string;
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
  input: CreateDocumentInput,
): Promise<CreateDocumentResult> {
  await ensureAppSchema();
  const storagePath = buildStoragePath(
    input.filingId,
    input.category,
    input.storageSlug,
    input.extension,
  );

  const upload = await getServiceRoleClient().storage
    .from(BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: input.mimeType,
      upsert: false,
    });
  if (upload.error) {
    throw new Error(`createDocument upload failed: ${upload.error.message}`);
  }

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86400000).toISOString()
    : null;

  const id = crypto.randomUUID();
  await getAppDb().execute({
    sql: `INSERT INTO user_documents
            (id, user_id, filing_id, category, scenario, filename, storage_path,
             size_bytes, mime_type, expires_at, created_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.userId,
      input.filingId,
      input.category,
      input.scenario ?? null,
      input.filename,
      storagePath,
      input.bytes.byteLength,
      input.mimeType,
      expiresAt,
      nowIso(),
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  });

  return { id, storagePath };
}

export interface ListDocumentsOpts {
  category?: Category;
  scenario?: string | null;
  /** Filter by metadata.formId — convenience for the "most recent 1040" query. */
  formId?: string;
  /** Filter by metadata.taxYear. */
  taxYear?: number;
  /** Override the scope's filing (e.g. a CPA reviewing another filing —
   *  membership must be verified by the caller first). */
  filingId?: string;
  limit?: number;
}

export async function listDocuments(
  scope: Scope,
  opts: ListDocumentsOpts = {},
): Promise<UserDocumentRow[]> {
  await ensureAppSchema();
  const conds: string[] = ["filing_id = ?"];
  const args: InValue[] = [opts.filingId ?? scope.filingId];
  if (opts.category) {
    conds.push("category = ?");
    args.push(opts.category);
  }
  if (opts.scenario !== undefined) {
    if (opts.scenario === null) conds.push("scenario IS NULL");
    else {
      conds.push("scenario = ?");
      args.push(opts.scenario);
    }
  }
  if (opts.formId) {
    conds.push(`json_extract(metadata, '$.formId') = ?`);
    args.push(opts.formId);
  }
  if (opts.taxYear !== undefined) {
    // metadata.taxYear is stored as a JSON number; json_extract returns it
    // numerically, so compare against the number (the old PostgREST ->> path
    // compared text — SQLite lets us skip the stringify).
    conds.push(`json_extract(metadata, '$.taxYear') = ?`);
    args.push(opts.taxYear);
  }
  args.push(Math.min(opts.limit ?? 100, 500));
  const res = await getAppDb().execute({
    sql: `SELECT * FROM user_documents WHERE ${conds.join(" AND ")}
          ORDER BY created_at DESC LIMIT ?`,
    args,
  });
  return res.rows.map(rowToDocument);
}
