import { createClient, type Client, type Row, type InValue } from "@libsql/client";
import { resolve } from "node:path";
import type { ActivityItem } from "@/lib/activity";
import type { RequestedAction } from "@/lib/requestedActions";
import type { TaxReturn } from "@/lib/returns";

// SERVER-ONLY domain reads/writes against the shared libsql app DB
// (.data/app.db under apps/agent — the agent owns schema creation; we just
// query). Replaces the per-table Postgres reads that used to live in
// lib/{activity,filings,returns,requestedActions}.ts.
//
// RLS is gone with Postgres, so every query here scopes explicitly by
// userId / filingId. Callers (Server Components, Route Handlers) are
// responsible for verifying the owner session (lib/localAuth.ts)
// BEFORE calling in.
//
// Never import this from a client component — @libsql/client and node:path
// don't exist in the browser bundle, and the DB file lives on the server box.

const DEFAULT_APP_DB = resolve(process.cwd(), "../agent/.data/app.db");

let cached: Client | null = null;

function db(): Client {
  if (cached) return cached;
  const path = process.env.APP_DB_PATH
    ? resolve(process.env.APP_DB_PATH)
    : DEFAULT_APP_DB;
  cached = createClient({ url: `file:${path}` });
  return cached;
}

const str = (v: unknown): string => (v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const json = (v: unknown): unknown => (v == null ? null : JSON.parse(String(v)));

// ─── Owner (single-user auth) ───────────────────────────────────────────

export interface OwnerAuthRow {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  sessionSecret: string;
}

// Idempotent — the agent's ensureAppSchema also creates this table, but the
// web app's first-run /setup can happen before the agent ever booted, so
// both sides CREATE IF NOT EXISTS. Keep the DDL in sync with
// apps/agent/src/mastra/db/appDb.ts.
let ownerTableReady: Promise<unknown> | null = null;
function ensureOwnerTable() {
  if (!ownerTableReady) {
    ownerTableReady = db().execute(
      `CREATE TABLE IF NOT EXISTS owner (
         id            TEXT PRIMARY KEY,
         email         TEXT NOT NULL,
         display_name  TEXT NOT NULL,
         password_hash TEXT NOT NULL,
         session_secret TEXT NOT NULL,
         created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       )`,
    );
  }
  return ownerTableReady;
}

export async function getOwnerAuthRow(): Promise<OwnerAuthRow | null> {
  await ensureOwnerTable();
  const res = await db().execute(
    `SELECT id, email, display_name, password_hash, session_secret FROM owner LIMIT 1`,
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: str(r.id),
    email: str(r.email),
    displayName: str(r.display_name),
    passwordHash: str(r.password_hash),
    sessionSecret: str(r.session_secret),
  };
}

export async function insertOwnerRow(row: OwnerAuthRow): Promise<void> {
  await ensureOwnerTable();
  await db().execute({
    sql: `INSERT INTO owner (id, email, display_name, password_hash, session_secret, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.email,
      row.displayName,
      row.passwordHash,
      row.sessionSecret,
      new Date().toISOString(),
    ],
  });
}

// ─── Filings / memberships ─────────────────────────────────────────────

export interface FilingRow {
  id: string;
  taxYear: number;
  status: string;
}

function rowToReturn(r: Row): TaxReturn {
  const status = str(r.status);
  return {
    id: String(num(r.tax_year)),
    year: num(r.tax_year),
    filingId: str(r.id),
    label: `${num(r.tax_year)} Return`,
    state: status === "filed" ? "filed" : "active",
    realDataAvailable: true,
    status,
  };
}

export async function listOwnerReturns(userId: string): Promise<TaxReturn[]> {
  const res = await db().execute({
    sql: `SELECT f.id, f.tax_year, f.status
          FROM filings f JOIN filing_members m ON m.filing_id = f.id
          WHERE m.user_id = ? AND m.role = 'owner' AND m.revoked_at IS NULL
          ORDER BY f.tax_year DESC`,
    args: [userId],
  });
  return res.rows.map(rowToReturn);
}

export async function getOwnerReturnByYear(
  userId: string,
  taxYear: number,
): Promise<TaxReturn | null> {
  const res = await db().execute({
    sql: `SELECT f.id, f.tax_year, f.status
          FROM filings f JOIN filing_members m ON m.filing_id = f.id
          WHERE m.user_id = ? AND m.role = 'owner' AND m.revoked_at IS NULL
            AND f.tax_year = ? LIMIT 1`,
    args: [userId, taxYear],
  });
  return res.rows[0] ? rowToReturn(res.rows[0]) : null;
}

export async function getOwnerFilingForYear(
  userId: string,
  taxYear: number,
): Promise<FilingRow> {
  const ret = await getOwnerReturnByYear(userId, taxYear);
  if (!ret) throw new Error(`No owner filing found for tax_year=${taxYear}.`);
  return { id: ret.filingId, taxYear: ret.year, status: ret.status };
}

/** Non-revoked membership check — the explicit RLS replacement used before
 *  reading anything belonging to a filing the caller doesn't own outright. */
export async function hasMembership(
  filingId: string,
  userId: string,
): Promise<boolean> {
  const res = await db().execute({
    sql: `SELECT 1 FROM filing_members
          WHERE filing_id = ? AND user_id = ? AND revoked_at IS NULL LIMIT 1`,
    args: [filingId, userId],
  });
  return res.rows.length > 0;
}

// ─── Activity feed ──────────────────────────────────────────────────────

export async function fetchActivityItems(
  userId: string,
  taxYear: number,
  limit = 50,
): Promise<ActivityItem[]> {
  const safeLimit = Math.min(limit, 200);
  const [facts, decisions] = await Promise.all([
    db().execute({
      sql: `SELECT id, created_at, fact_key, category, fact_value, source_note
            FROM tax_facts WHERE user_id = ? AND tax_year = ?
            ORDER BY created_at DESC LIMIT ?`,
      args: [userId, taxYear, safeLimit],
    }),
    db().execute({
      sql: `SELECT id, created_at, decision_key, decision, rationale,
                   supporting_fact_keys, confidence, verdict, verdict_reason, source_note
            FROM ai_decisions WHERE user_id = ? AND tax_year = ?
            ORDER BY created_at DESC LIMIT ?`,
      args: [userId, taxYear, safeLimit],
    }),
  ]);

  const factItems: ActivityItem[] = facts.rows.map((r) => ({
    kind: "fact" as const,
    id: str(r.id),
    createdAt: str(r.created_at),
    title: str(r.fact_key),
    category: str(r.category),
    value: json(r.fact_value),
    sourceNote: strOrNull(r.source_note),
  }));
  const decisionItems: ActivityItem[] = decisions.rows.map((r) => {
    const supporting = json(r.supporting_fact_keys);
    return {
      kind: "decision" as const,
      id: str(r.id),
      createdAt: str(r.created_at),
      title: str(r.decision_key),
      value: json(r.decision),
      sourceNote: strOrNull(r.source_note),
      rationale: strOrNull(r.rationale) ?? undefined,
      supportingFactKeys: Array.isArray(supporting)
        ? (supporting as string[])
        : undefined,
      confidence:
        (strOrNull(r.confidence) as ActivityItem["confidence"]) ?? undefined,
      verdict: (strOrNull(r.verdict) as ActivityItem["verdict"]) ?? null,
      verdictReason: strOrNull(r.verdict_reason),
    };
  });

  return [...factItems, ...decisionItems]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, safeLimit);
}

// ─── Requested actions ──────────────────────────────────────────────────

function rowToAction(r: Row): RequestedAction {
  return {
    id: str(r.id),
    taxYear: num(r.tax_year),
    kind: str(r.kind) as RequestedAction["kind"],
    title: str(r.title),
    detail: strOrNull(r.detail),
    documentType: strOrNull(r.document_type),
    acceptPattern: strOrNull(r.accept_pattern),
    status: str(r.status) as RequestedAction["status"],
    resolvedDocumentId: strOrNull(r.resolved_document_id),
    createdAt: str(r.created_at),
    resolvedAt: strOrNull(r.resolved_at),
  };
}

export async function fetchOpenActions(
  userId: string,
  taxYear: number,
): Promise<RequestedAction[]> {
  const res = await db().execute({
    sql: `SELECT * FROM requested_actions
          WHERE user_id = ? AND tax_year = ? AND status IN ('open','processing')
          ORDER BY created_at DESC`,
    args: [userId, taxYear],
  });
  return res.rows.map(rowToAction);
}

export async function markActionProcessing(
  userId: string,
  actionId: string,
  documentId: string,
): Promise<void> {
  await db().execute({
    sql: `UPDATE requested_actions
          SET status = 'processing', resolved_document_id = ?
          WHERE id = ? AND user_id = ?`,
    args: [documentId, actionId, userId],
  });
}

export async function skipAction(
  userId: string,
  actionId: string,
): Promise<void> {
  await db().execute({
    sql: `UPDATE requested_actions
          SET status = 'skipped', resolved_at = ?
          WHERE id = ? AND user_id = ?`,
    args: [new Date().toISOString(), actionId, userId],
  });
}

// ─── User documents ─────────────────────────────────────────────────────

export interface DocumentLookup {
  id: string;
  filingId: string;
  storagePath: string;
  filename: string;
  mimeType: string | null;
}

export async function getDocumentById(
  id: string,
): Promise<DocumentLookup | null> {
  const res = await db().execute({
    sql: `SELECT id, filing_id, storage_path, filename, mime_type
          FROM user_documents WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: str(r.id),
    filingId: str(r.filing_id),
    storagePath: str(r.storage_path),
    filename: str(r.filename),
    mimeType: strOrNull(r.mime_type),
  };
}

export interface UploadListRow {
  id: string;
  filename: string;
  created_at: string;
  mime_type: string | null;
  size_bytes: number | null;
}

/** Uploaded (category='uploads') docs for a filing, newest first — the
 *  Documents tab grid + home-tab quick links. snake_case keys preserved
 *  because the components already render that shape. */
export async function listUploads(filingId: string): Promise<UploadListRow[]> {
  const res = await db().execute({
    sql: `SELECT id, filename, created_at, mime_type, size_bytes
          FROM user_documents WHERE filing_id = ? AND category = 'uploads'
          ORDER BY created_at DESC`,
    args: [filingId],
  });
  return res.rows.map((r) => ({
    id: str(r.id),
    filename: str(r.filename),
    created_at: str(r.created_at),
    mime_type: strOrNull(r.mime_type),
    size_bytes: r.size_bytes == null ? null : num(r.size_bytes),
  }));
}

export interface DraftListRow {
  id: string;
  filename: string;
  created_at: string;
  mime_type: string | null;
  size_bytes: number | null;
  metadata: Record<string, unknown> | null;
}

/** Engine-generated drafts for a filing, newest first — the Forms tab.
 *  snake_case keys preserved for the existing components. */
export async function listDrafts(filingId: string): Promise<DraftListRow[]> {
  const res = await db().execute({
    sql: `SELECT id, filename, created_at, mime_type, size_bytes, metadata
          FROM user_documents WHERE filing_id = ? AND category = 'drafts'
          ORDER BY created_at DESC`,
    args: [filingId],
  });
  return res.rows.map((r) => ({
    id: str(r.id),
    filename: str(r.filename),
    created_at: str(r.created_at),
    mime_type: strOrNull(r.mime_type),
    size_bytes: r.size_bytes == null ? null : num(r.size_bytes),
    metadata: json(r.metadata) as Record<string, unknown> | null,
  }));
}

export async function insertUploadedDocument(args: {
  userId: string;
  filingId: string;
  filename: string;
  storagePath: string;
  sizeBytes: number;
  mimeType: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db().execute({
    sql: `INSERT INTO user_documents
            (id, user_id, filing_id, category, filename, storage_path,
             size_bytes, mime_type, created_at)
          VALUES (?, ?, ?, 'uploads', ?, ?, ?, ?, ?)`,
    args: [
      id,
      args.userId,
      args.filingId,
      args.filename,
      args.storagePath,
      args.sizeBytes,
      args.mimeType,
      new Date().toISOString(),
    ],
  });
  return id;
}
