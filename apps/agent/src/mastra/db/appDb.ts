import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";

// Per-user DOMAIN data (tax_facts, ai_decisions, filings, …) lives in a local
// libsql/SQLite file — separate from corpus.db, which is a prebuilt shippable
// asset. This replaces the Supabase Postgres domain tables + RLS.
//
// RLS is gone with Postgres, so scoping is explicit: every helper in
// taxFacts/aiDecisions/etc. takes a `Scope { userId, filingId }` and writes
// the WHERE clauses the database used to add for us. The multi-user tables
// (filing_members, cpa_profiles, filing_invites) are kept dormant per the
// transition plan — single-user instances just have one owner membership.
//
// Path resolution mirrors db/libsql.ts: APP_DB_PATH env wins, else
// <apps/agent>/.data/app.db anchored to this module so cwd doesn't matter.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url)); // …/src/mastra/db
const DEFAULT_DB_PATH = resolve(MODULE_DIR, "../../../.data/app.db");

function appDbPath(): string {
  return process.env.APP_DB_PATH
    ? resolve(process.env.APP_DB_PATH)
    : DEFAULT_DB_PATH;
}

/** Explicit per-request scoping — the replacement for RLS. Built by
 *  requireUserContext (agent) or the membership-verified route handlers. */
export interface Scope {
  userId: string;
  filingId: string;
}

// Cell readers — libsql row values are string | number | bigint | ArrayBuffer
// | null. Exported for the domain helper modules.
export const asStr = (v: unknown): string => (v == null ? "" : String(v));
export const asStrOrNull = (v: unknown): string | null =>
  v == null ? null : String(v);
export const asNum = (v: unknown): number => (v == null ? 0 : Number(v));
export const asNumOrNull = (v: unknown): number | null =>
  v == null ? null : Number(v);
/** Parse a TEXT column holding JSON; null stays null. */
export const asJson = (v: unknown): unknown =>
  v == null ? null : JSON.parse(String(v));

/** ISO timestamp — written from JS so ordering semantics match the old
 *  Postgres timestamptz strings the web app sorts on. */
export const nowIso = (): string => new Date().toISOString();

let cached: Client | null = null;
let schemaReady: Promise<void> | null = null;

export function getAppDb(): Client {
  if (cached) return cached;
  const path = appDbPath();
  mkdirSync(dirname(path), { recursive: true });
  cached = createClient({ url: `file:${path}` });
  return cached;
}

// Idempotent schema init — every statement CREATE … IF NOT EXISTS. SQLite
// type mapping from the Postgres migrations: uuid → TEXT, jsonb → TEXT
// (JSON.stringify at write, JSON.parse at read), timestamptz → TEXT (ISO).
export function ensureAppSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = getAppDb();
    // FK ON DELETE CASCADE (domain rows → filings) needs this per connection.
    await db.execute("PRAGMA foreign_keys = ON");
    await db.batch(
      [
        // The single owner of this instance. Identity = the instance; this
        // row holds profile data (name/email, used for form prefill +
        // authEmail) and the web gate's credentials (scrypt password hash +
        // the HMAC secret for session cookies). Created by the web app's
        // first-run /setup screen. The agent only READS it (ownerMiddleware
        // resolves the owner as the resource id for every request).
        `CREATE TABLE IF NOT EXISTS owner (
           id            TEXT PRIMARY KEY,
           email         TEXT NOT NULL,
           display_name  TEXT NOT NULL,
           password_hash TEXT NOT NULL,
           session_secret TEXT NOT NULL,
           created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         )`,
        `CREATE TABLE IF NOT EXISTS filings (
           id         TEXT PRIMARY KEY,
           tax_year   INTEGER NOT NULL,
           status     TEXT NOT NULL DEFAULT 'draft',
           created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         )`,
        `CREATE INDEX IF NOT EXISTS idx_filings_tax_year ON filings(tax_year)`,
        `CREATE TABLE IF NOT EXISTS filing_members (
           filing_id  TEXT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
           user_id    TEXT NOT NULL,
           role       TEXT NOT NULL CHECK (role IN ('owner','cpa_reviewer')),
           added_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           revoked_at TEXT,
           PRIMARY KEY (filing_id, user_id)
         )`,
        `CREATE INDEX IF NOT EXISTS idx_filing_members_user ON filing_members(user_id) WHERE revoked_at IS NULL`,
        `CREATE TABLE IF NOT EXISTS cpa_profiles (
           user_id        TEXT PRIMARY KEY,
           display_name   TEXT NOT NULL,
           firm           TEXT,
           license_number TEXT,
           created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         )`,
        `CREATE TABLE IF NOT EXISTS filing_invites (
           filing_id          TEXT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
           invitee_user_id    TEXT NOT NULL,
           invited_by_user_id TEXT NOT NULL,
           status             TEXT NOT NULL CHECK (status IN ('pending','accepted','revoked')),
           invited_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           accepted_at        TEXT,
           revoked_at         TEXT,
           PRIMARY KEY (filing_id, invitee_user_id)
         )`,
        `CREATE TABLE IF NOT EXISTS tax_facts (
           id          TEXT PRIMARY KEY,
           user_id     TEXT NOT NULL,
           filing_id   TEXT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
           tax_year    INTEGER NOT NULL,
           category    TEXT NOT NULL,
           fact_key    TEXT NOT NULL,
           fact_value  TEXT,
           source_note TEXT,
           created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         )`,
        `CREATE INDEX IF NOT EXISTS idx_tax_facts_filing ON tax_facts(filing_id, created_at)`,
        `CREATE INDEX IF NOT EXISTS idx_tax_facts_key ON tax_facts(filing_id, fact_key)`,
        `CREATE TABLE IF NOT EXISTS open_questions (
           id          TEXT PRIMARY KEY,
           user_id     TEXT NOT NULL,
           filing_id   TEXT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
           status      TEXT NOT NULL DEFAULT 'open',
           question    TEXT NOT NULL,
           context     TEXT,
           decision_id TEXT,
           created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           resolved_at TEXT
         )`,
        `CREATE INDEX IF NOT EXISTS idx_open_questions_filing ON open_questions(filing_id, status)`,
        `CREATE TABLE IF NOT EXISTS ai_decisions (
           id                       TEXT PRIMARY KEY,
           user_id                  TEXT NOT NULL,
           filing_id                TEXT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
           tax_year                 INTEGER NOT NULL,
           decision_key             TEXT NOT NULL,
           decision                 TEXT,
           rationale                TEXT NOT NULL,
           supporting_fact_keys     TEXT,
           confidence               TEXT NOT NULL,
           dissenting_considerations TEXT,
           authority_citations      TEXT,
           source_note              TEXT,
           created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           verdict                  TEXT,
           verdict_reason           TEXT,
           verdict_at               TEXT,
           latest_review_run_id     TEXT
         )`,
        `CREATE INDEX IF NOT EXISTS idx_ai_decisions_filing ON ai_decisions(filing_id, created_at)`,
        `CREATE TABLE IF NOT EXISTS user_documents (
           id           TEXT PRIMARY KEY,
           user_id      TEXT NOT NULL,
           filing_id    TEXT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
           category     TEXT NOT NULL CHECK (category IN ('drafts','finals','uploads')),
           scenario     TEXT,
           filename     TEXT NOT NULL,
           storage_path TEXT NOT NULL,
           size_bytes   INTEGER,
           mime_type    TEXT,
           expires_at   TEXT,
           created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           metadata     TEXT
         )`,
        `CREATE INDEX IF NOT EXISTS idx_user_documents_filing ON user_documents(filing_id, category, created_at)`,
        `CREATE TABLE IF NOT EXISTS requested_actions (
           id                   TEXT PRIMARY KEY,
           user_id              TEXT NOT NULL,
           filing_id            TEXT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
           tax_year             INTEGER NOT NULL,
           kind                 TEXT NOT NULL CHECK (kind IN ('upload','confirm','decide')),
           title                TEXT NOT NULL,
           detail               TEXT,
           document_type        TEXT,
           accept_pattern       TEXT,
           status               TEXT NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open','processing','resolved','skipped','dismissed')),
           resolved_document_id TEXT,
           created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           resolved_at          TEXT
         )`,
        `CREATE INDEX IF NOT EXISTS idx_requested_actions_filing ON requested_actions(filing_id, status, created_at)`,
        `CREATE TABLE IF NOT EXISTS review_runs (
           id              TEXT PRIMARY KEY,
           decision_id     TEXT NOT NULL,
           user_id         TEXT NOT NULL,
           filing_id       TEXT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
           status          TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
           final_verdict   TEXT,
           iteration_count INTEGER,
           error           TEXT,
           started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           completed_at    TEXT,
           duration_ms     INTEGER
         )`,
        `CREATE INDEX IF NOT EXISTS idx_review_runs_decision ON review_runs(decision_id)`,
        `CREATE TABLE IF NOT EXISTS review_run_steps (
           id          TEXT PRIMARY KEY,
           run_id      TEXT NOT NULL,
           user_id     TEXT NOT NULL,
           filing_id   TEXT NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
           iteration   INTEGER NOT NULL,
           step_kind   TEXT NOT NULL,
           input_json  TEXT,
           output_json TEXT,
           duration_ms INTEGER,
           created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         )`,
        `CREATE INDEX IF NOT EXISTS idx_review_run_steps_run ON review_run_steps(run_id, iteration)`,
      ],
      "write",
    );
  })();
  return schemaReady;
}

// ---------------------------------------------------------------------------
// Owner — the instance's single user. See the owner table comment above.
// ---------------------------------------------------------------------------

export interface Owner {
  id: string;
  email: string;
  displayName: string;
}

/** The instance owner, or null before first-run setup has been completed. */
export async function getOwner(): Promise<Owner | null> {
  await ensureAppSchema();
  const res = await getAppDb().execute(`SELECT id, email, display_name FROM owner LIMIT 1`);
  const r = res.rows[0];
  if (!r) return null;
  return { id: asStr(r.id), email: asStr(r.email), displayName: asStr(r.display_name) };
}
