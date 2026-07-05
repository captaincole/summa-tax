import { fileURLToPath } from "node:url";
import { dirname, resolve, join, sep } from "node:path";
import { mkdir, writeFile, readFile, unlink, rm } from "node:fs/promises";

// Local filesystem store for document bytes — replaces the Supabase Storage
// `user-documents` bucket (Phase 1 step 4). Layout mirrors the old bucket:
//
//   <documents root>/{filingId}/{category}/{slug}-{ulid}.{ext}
//
// user_documents.storage_path keeps the same relative-path convention, so
// only the byte I/O changed — metadata rows and download URLs are untouched.
// Access control happens in the callers (explicit membership checks against
// the libsql app DB) exactly as it did for the interim service-role clients
// this module deletes.
//
// Path resolution mirrors db/appDb.ts: DOCUMENTS_PATH env wins (set it in
// .env.development — module-relative defaults resolve differently in
// Mastra's bundled output than in tsx source, see the step-3 gotcha), else
// <apps/agent>/.data/documents.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url)); // …/src/mastra/db
const DEFAULT_ROOT = resolve(MODULE_DIR, "../../../.data/documents");

export function documentsRoot(): string {
  return process.env.DOCUMENTS_PATH
    ? resolve(process.env.DOCUMENTS_PATH)
    : DEFAULT_ROOT;
}

// Storage paths come from our own DB rows, but resolve defensively anyway —
// a `..` segment must never escape the documents root.
function safeJoin(storagePath: string): string {
  const root = documentsRoot();
  const full = resolve(join(root, storagePath));
  if (!full.startsWith(root + sep)) {
    throw new Error(`invalid storage path: ${storagePath}`);
  }
  return full;
}

export async function writeBlob(
  storagePath: string,
  bytes: Buffer | Uint8Array,
): Promise<void> {
  const full = safeJoin(storagePath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, bytes);
}

export async function readBlob(storagePath: string): Promise<Buffer> {
  return readFile(safeJoin(storagePath));
}

/** Best-effort delete — missing files are fine (already gone). */
export async function deleteBlob(storagePath: string): Promise<void> {
  await unlink(safeJoin(storagePath)).catch(() => {});
}

/** Remove every blob under a filing (delete-filing cascade companion). */
export async function deleteFilingBlobs(filingId: string): Promise<void> {
  await rm(safeJoin(filingId), { recursive: true, force: true });
}
