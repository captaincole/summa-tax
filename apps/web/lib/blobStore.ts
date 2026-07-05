import { resolve, join, sep, dirname } from "node:path";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";

// SERVER-ONLY filesystem store for document bytes — the web-side mirror of
// apps/agent/src/mastra/db/blobStore.ts (same directory, same
// {filingId}/{category}/{slug}-{ulid}.{ext} layout; no shared package yet).
// Replaces the Supabase Storage bucket + the interim service-role client.
// Access control happens in the route handlers (serverDb membership checks)
// before any call here — there is no storage-layer ACL.

const DEFAULT_ROOT = resolve(process.cwd(), "../agent/.data/documents");

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
