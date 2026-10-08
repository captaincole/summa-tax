import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { resolveEmbeddings } from "../../refdocs/embeddings";

// The reference corpus lives in a single local libsql/SQLite file — "the DB is
// a file." This replaces the Supabase/Postgres corpus store (ref_* tables +
// the match_ref_blocks RPC). One @libsql/client drives text (FTS5), vectors
// (native F32_BLOB + vector_distance_cos), and the relational doc graph.
//
// Path resolution:
//   - CORPUS_DB_PATH env wins (set it in .env.development so `mastra dev` and
//     the refdocs:* scripts agree on one file).
//   - Otherwise default to <apps/agent>/.data/corpus.db, anchored to this
//     module's location so cwd (repo root vs apps/agent vs mastra public)
//     doesn't matter for local dev.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url)); // …/src/mastra/db
const DEFAULT_DB_PATH = resolve(MODULE_DIR, "../../../.data/corpus.db"); // …/apps/agent/.data/corpus.db

function corpusDbPath(): string {
  return process.env.CORPUS_DB_PATH
    ? resolve(process.env.CORPUS_DB_PATH)
    : DEFAULT_DB_PATH;
}

let cached: Client | null = null;
let schemaReady: Promise<void> | null = null;

// Declared dimension for the ref_blocks.embedding column on a FRESH db
// (voyage-law-2 = 1024, embeddinggemma-2 = 768). Only consulted at CREATE
// TABLE time — SQLite doesn't enforce the declared dim, and we have no ANN
// index, so an existing db keeps working if the provider changes; what
// actually matters is that stored and query vectors come from the same
// model, which ref_meta.embedding_model guards (see db/refDocs.ts).
function embeddingDims(): number {
  try {
    return resolveEmbeddings()?.dims ?? 1024;
  } catch {
    // Misconfigured EMBEDDINGS_MODEL shouldn't block schema creation; the
    // embed/search paths surface the real error.
    return 1024;
  }
}

export function getCorpusDb(): Client {
  if (cached) return cached;
  const path = corpusDbPath();
  mkdirSync(dirname(path), { recursive: true });
  cached = createClient({ url: `file:${path}` });
  return cached;
}

// Idempotent schema init. Safe to call on a prebuilt (shipped) .db — every
// statement is CREATE … IF NOT EXISTS. Runs at most once per process.
export function ensureCorpusSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = getCorpusDb();
    // FK ON DELETE CASCADE (ref_pages/sections/blocks → ref_documents) needs
    // this per connection; SQLite defaults it off.
    await db.execute("PRAGMA foreign_keys = ON");
    await db.batch(
      [
        `CREATE TABLE IF NOT EXISTS ref_documents (
           doc_id              TEXT PRIMARY KEY,
           title               TEXT NOT NULL,
           publisher           TEXT NOT NULL,
           tax_year            INTEGER,
           source_path         TEXT NOT NULL,
           source_url          TEXT,
           sha256              TEXT NOT NULL,
           total_pages         INTEGER NOT NULL,
           total_chars         INTEGER NOT NULL,
           canonical_text_path TEXT NOT NULL,
           ingested_at         TEXT NOT NULL DEFAULT (datetime('now'))
         )`,
        `CREATE TABLE IF NOT EXISTS ref_pages (
           doc_id     TEXT NOT NULL REFERENCES ref_documents(doc_id) ON DELETE CASCADE,
           page_num   INTEGER NOT NULL,
           char_start INTEGER NOT NULL,
           char_end   INTEGER NOT NULL,
           PRIMARY KEY (doc_id, page_num)
         )`,
        `CREATE TABLE IF NOT EXISTS ref_sections (
           section_id        TEXT PRIMARY KEY,
           doc_id            TEXT NOT NULL REFERENCES ref_documents(doc_id) ON DELETE CASCADE,
           heading           TEXT NOT NULL,
           heading_slug      TEXT NOT NULL,
           parent_section_id TEXT,
           ordinal           INTEGER NOT NULL,
           first_page        INTEGER NOT NULL,
           char_start        INTEGER NOT NULL,
           char_end          INTEGER NOT NULL
         )`,
        `CREATE INDEX IF NOT EXISTS idx_ref_sections_doc ON ref_sections(doc_id, ordinal)`,
        `CREATE TABLE IF NOT EXISTS ref_blocks (
           block_id            TEXT PRIMARY KEY,
           doc_id              TEXT NOT NULL REFERENCES ref_documents(doc_id) ON DELETE CASCADE,
           section_id          TEXT REFERENCES ref_sections(section_id) ON DELETE SET NULL,
           page_num            INTEGER NOT NULL,
           block_type          TEXT NOT NULL,
           ordinal             INTEGER NOT NULL,
           text                TEXT NOT NULL,
           char_start          INTEGER NOT NULL,
           char_end            INTEGER NOT NULL,
           metadata_json       TEXT,
           contextual_summary  TEXT,
           contextualized_text TEXT,
           block_text_sha1     TEXT,
           embedding           F32_BLOB(${embeddingDims()})
         )`,
        `CREATE INDEX IF NOT EXISTS idx_ref_blocks_doc_ord ON ref_blocks(doc_id, ordinal)`,
        `CREATE INDEX IF NOT EXISTS idx_ref_blocks_section ON ref_blocks(section_id, ordinal)`,
        `CREATE INDEX IF NOT EXISTS idx_ref_blocks_page ON ref_blocks(doc_id, page_num)`,
        // FTS5 mirror of ref_blocks. content = coalesce(contextualized_text, text),
        // populated at writeDocument time (SQLite FTS5 has no generated-column
        // equivalent of Postgres's tsvector column). Porter stemming approximates
        // Postgres's 'english' config. No vector index — brute-force
        // vector_distance_cos is exact and fast at our scale (low-thousands).
        `CREATE VIRTUAL TABLE IF NOT EXISTS ref_blocks_fts USING fts5(
           block_id UNINDEXED,
           doc_id UNINDEXED,
           content,
           tokenize = 'porter unicode61'
         )`,
        // Corpus-level key/value metadata. Today: embedding_model — which
        // "provider/model" produced the stored vectors, so search can refuse
        // to compare query vectors from a different model (db/refDocs.ts).
        `CREATE TABLE IF NOT EXISTS ref_meta (
           key   TEXT PRIMARY KEY,
           value TEXT NOT NULL
         )`,
        // Form catalog — the inventory side of the form engine (one row per
        // (form_id, tax_year) + one per field). Written by the forms-ingest
        // pipeline (--write-db); the runtime still reads the JSON fixtures
        // (catalog.ts loadFromFixtures is authoritative, loadFromDb dormant).
        // Lives in corpus.db because it's shared reference data that ships
        // prebuilt, like the instruction corpus.
        `CREATE TABLE IF NOT EXISTS forms (
           form_id      TEXT NOT NULL,
           tax_year     INTEGER NOT NULL,
           jurisdiction TEXT NOT NULL,
           title        TEXT NOT NULL,
           created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           PRIMARY KEY (form_id, tax_year)
         )`,
        `CREATE TABLE IF NOT EXISTS form_fields (
           field_id        TEXT NOT NULL,
           form_id         TEXT NOT NULL,
           tax_year        INTEGER NOT NULL,
           ordinal         INTEGER NOT NULL,
           label           TEXT NOT NULL,
           category        TEXT NOT NULL,
           value_type      TEXT NOT NULL,
           pdf_widget_name TEXT,
           position        TEXT,
           updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
           PRIMARY KEY (field_id, tax_year)
         )`,
        `CREATE INDEX IF NOT EXISTS idx_form_fields_form ON form_fields(form_id, tax_year, ordinal)`,
      ],
      "write",
    );
    // Loud once-per-process nudge: an empty corpus means grounding reviews
    // can't retrieve anything (verdicts degrade to needs_more_facts). The
    // app keeps working — same graceful-degrade posture as Ollama being down.
    const count = await db.execute(`SELECT count(*) AS n FROM ref_documents`);
    if (Number(count.rows[0]?.n ?? 0) === 0) {
      console.warn(
        "[corpus] reference corpus is EMPTY — grounding reviews will return " +
          "needs_more_facts. Run `npm run corpus -- fetch` (prebuilt) or " +
          "`npm run corpus -- sync` (rebuild, needs ANTHROPIC_API_KEY + Ollama).",
      );
    }
  })();
  return schemaReady;
}
