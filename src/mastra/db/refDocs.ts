import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.DATABASE_URL ?? "file:./wheel-of-time.db",
});

let ready: Promise<void> | null = null;

function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS ref_documents (
          doc_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          publisher TEXT NOT NULL,
          tax_year INTEGER,
          source_path TEXT NOT NULL,
          source_url TEXT,
          sha256 TEXT NOT NULL,
          total_pages INTEGER NOT NULL,
          total_chars INTEGER NOT NULL,
          canonical_text_path TEXT NOT NULL,
          ingested_at INTEGER NOT NULL
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS ref_pages (
          doc_id TEXT NOT NULL,
          page_num INTEGER NOT NULL,
          char_start INTEGER NOT NULL,
          char_end INTEGER NOT NULL,
          PRIMARY KEY (doc_id, page_num)
        )
      `);

      await client.execute(`
        CREATE TABLE IF NOT EXISTS ref_sections (
          section_id TEXT PRIMARY KEY,
          doc_id TEXT NOT NULL,
          heading TEXT NOT NULL,
          heading_slug TEXT NOT NULL,
          parent_section_id TEXT,
          ordinal INTEGER NOT NULL,
          first_page INTEGER NOT NULL,
          char_start INTEGER NOT NULL,
          char_end INTEGER NOT NULL
        )
      `);
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_ref_sections_doc ON ref_sections(doc_id, ordinal)`,
      );

      await client.execute(`
        CREATE TABLE IF NOT EXISTS ref_blocks (
          block_id TEXT PRIMARY KEY,
          doc_id TEXT NOT NULL,
          section_id TEXT,
          page_num INTEGER NOT NULL,
          block_type TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          text TEXT NOT NULL,
          char_start INTEGER NOT NULL,
          char_end INTEGER NOT NULL,
          metadata_json TEXT
        )
      `);
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_ref_blocks_doc_ord ON ref_blocks(doc_id, ordinal)`,
      );
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_ref_blocks_section ON ref_blocks(section_id, ordinal)`,
      );
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_ref_blocks_page ON ref_blocks(doc_id, page_num)`,
      );

      // RAG additions (Anthropic Contextual Retrieval recipe).
      //   - contextual_summary:    Haiku-generated 50-100 token blurb situating
      //                            this block within the whole document.
      //   - contextualized_text:   summary + "\n\n" + text. Both embedded and
      //                            FTS-indexed; this is what queries match against.
      //   - block_text_sha1:       hash of the original text. Lets re-ingestion
      //                            skip re-summarizing unchanged blocks.
      //   - embedding:             voyage-law-2 vector of contextualized_text.
      const blockCols = await client.execute(`PRAGMA table_info(ref_blocks)`);
      const blockColNames = new Set(
        blockCols.rows.map((r) => String(r.name)),
      );
      if (!blockColNames.has("contextual_summary")) {
        await client.execute(
          `ALTER TABLE ref_blocks ADD COLUMN contextual_summary TEXT`,
        );
      }
      if (!blockColNames.has("contextualized_text")) {
        await client.execute(
          `ALTER TABLE ref_blocks ADD COLUMN contextualized_text TEXT`,
        );
      }
      if (!blockColNames.has("block_text_sha1")) {
        await client.execute(
          `ALTER TABLE ref_blocks ADD COLUMN block_text_sha1 TEXT`,
        );
      }
      if (!blockColNames.has("embedding")) {
        // libsql's F32_BLOB(n) is the typed-vector column. The dimension must
        // match voyage-law-2's output (1024).
        await client.execute(
          `ALTER TABLE ref_blocks ADD COLUMN embedding F32_BLOB(1024)`,
        );
      }
      // Vector index for fast cosine nearest-neighbor lookup. libsql skips
      // creation if it already exists at this name.
      await client.execute(
        `CREATE INDEX IF NOT EXISTS idx_ref_blocks_embedding
         ON ref_blocks(libsql_vector_idx(embedding))`,
      );

      // FTS5 index. We index `contextualized_text` so the contextual summary
      // contributes to lexical (BM25) matches alongside semantic search.
      // If an older FTS table exists with the prior `text` column, drop it
      // so the column shape matches what writeDocument now populates.
      const ftsInfo = await client.execute(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='ref_blocks_fts'`,
      );
      const ftsSql =
        ftsInfo.rows.length > 0 ? String(ftsInfo.rows[0].sql ?? "") : "";
      const hasContextualizedFts = /contextualized_text/.test(ftsSql);
      if (ftsInfo.rows.length > 0 && !hasContextualizedFts) {
        await client.execute(`DROP TABLE ref_blocks_fts`);
      }
      await client.execute(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ref_blocks_fts USING fts5(
          block_id UNINDEXED,
          doc_id UNINDEXED,
          section_id UNINDEXED,
          page_num UNINDEXED,
          section_heading,
          contextualized_text,
          tokenize = 'porter unicode61 remove_diacritics 2'
        )
      `);
    })();
  }
  return ready;
}

export interface RefDocument {
  docId: string;
  title: string;
  publisher: string;
  taxYear: number | null;
  sourcePath: string;
  sourceUrl: string | null;
  sha256: string;
  totalPages: number;
  totalChars: number;
  canonicalTextPath: string;
}

export interface RefPage {
  docId: string;
  pageNum: number;
  charStart: number;
  charEnd: number;
}

export interface RefSection {
  sectionId: string;
  docId: string;
  heading: string;
  headingSlug: string;
  parentSectionId: string | null;
  ordinal: number;
  firstPage: number;
  charStart: number;
  charEnd: number;
}

export type RefBlockType =
  | "paragraph"
  | "heading"
  | "list_item"
  | "table"
  | "table_row"
  | "callout";

export interface RefBlock {
  blockId: string;
  docId: string;
  sectionId: string | null;
  pageNum: number;
  blockType: RefBlockType;
  ordinal: number;
  text: string;
  charStart: number;
  charEnd: number;
  metadata?: Record<string, unknown>;
  // RAG additions. Populated during ingest after parseDoc; null on legacy
  // rows or when the contextualization step is skipped.
  contextualSummary?: string | null;
  contextualizedText?: string | null;
  blockTextSha1?: string | null;
  embedding?: number[] | null;
}

export interface SearchHit {
  blockId: string;
  docId: string;
  documentTitle: string;
  sectionId: string | null;
  sectionHeading: string | null;
  pageNum: number;
  blockType: RefBlockType;
  text: string;
  snippet: string;
  score: number;
  citation: string;
}

export interface BlockDetail {
  blockId: string;
  docId: string;
  documentTitle: string;
  publisher: string;
  taxYear: number | null;
  sectionId: string | null;
  sectionHeading: string | null;
  pageNum: number;
  blockType: RefBlockType;
  text: string;
  charStart: number;
  charEnd: number;
  citation: string;
}

// FTS5 treats many punctuation characters as syntax (quotes, parens, colons,
// minus, carets). We sanitize the user's query to plain words + whitespace so
// the agent can pass natural language without hitting parser errors. Tokens
// separated by whitespace imply AND in FTS5, which is what we want.
function sanitizeFtsQuery(q: string): string {
  return q
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCitation(
  documentTitle: string,
  sectionHeading: string | null,
  pageNum: number,
): string {
  const parts = [documentTitle];
  if (sectionHeading && sectionHeading !== "(Preamble)") {
    parts.push(`§ ${sectionHeading}`);
  }
  parts.push(`p. ${pageNum}`);
  return parts.join(", ");
}

export interface SearchOpts {
  query: string;
  docId?: string;
  limit?: number;
}

export async function searchRefDocs(opts: SearchOpts): Promise<SearchHit[]> {
  await ensureSchema();
  const sanitized = sanitizeFtsQuery(opts.query);
  if (sanitized.length === 0) return [];

  const limit = Math.min(opts.limit ?? 5, 25);

  const where: string[] = ["ref_blocks_fts MATCH ?"];
  const args: (string | number)[] = [sanitized];
  if (opts.docId) {
    where.push("ref_blocks_fts.doc_id = ?");
    args.push(opts.docId);
  }

  const r = await client.execute({
    sql: `SELECT
            b.block_id, b.doc_id, b.section_id, b.page_num, b.block_type, b.text,
            d.title AS doc_title,
            s.heading AS section_heading,
            snippet(ref_blocks_fts, 5, '<<', '>>', '…', 14) AS snip,
            bm25(ref_blocks_fts) AS score
          FROM ref_blocks_fts
          JOIN ref_blocks b ON b.block_id = ref_blocks_fts.block_id
          JOIN ref_documents d ON d.doc_id = b.doc_id
          LEFT JOIN ref_sections s ON s.section_id = b.section_id
          WHERE ${where.join(" AND ")}
          ORDER BY score
          LIMIT ?`,
    args: [...args, limit],
  });

  return r.rows.map((row) => {
    const sectionHeading =
      row.section_heading == null ? null : String(row.section_heading);
    const documentTitle = String(row.doc_title);
    const pageNum = Number(row.page_num);
    return {
      blockId: String(row.block_id),
      docId: String(row.doc_id),
      documentTitle,
      sectionId: row.section_id == null ? null : String(row.section_id),
      sectionHeading,
      pageNum,
      blockType: String(row.block_type) as RefBlockType,
      text: String(row.text),
      snippet: String(row.snip),
      score: Number(row.score),
      citation: buildCitation(documentTitle, sectionHeading, pageNum),
    };
  });
}

export interface VectorSearchOpts {
  /** Pre-computed query embedding (caller is responsible for embedding the
   *  query string with the same model used at ingest). */
  queryEmbedding: number[];
  docId?: string;
  limit?: number;
}

export async function vectorSearchRefDocs(
  opts: VectorSearchOpts,
): Promise<SearchHit[]> {
  await ensureSchema();
  const limit = Math.min(opts.limit ?? 5, 50);
  const where: string[] = ["b.embedding IS NOT NULL"];
  const args: (string | number)[] = [];
  if (opts.docId) {
    where.push("b.doc_id = ?");
    args.push(opts.docId);
  }

  // libsql vector_distance_cos: smaller = closer. Range [0, 2].
  const vecLiteral = `vector('${JSON.stringify(opts.queryEmbedding)}')`;
  const r = await client.execute({
    sql: `SELECT
            b.block_id, b.doc_id, b.section_id, b.page_num, b.block_type, b.text,
            d.title AS doc_title,
            s.heading AS section_heading,
            vector_distance_cos(b.embedding, ${vecLiteral}) AS dist
          FROM ref_blocks b
          JOIN ref_documents d ON d.doc_id = b.doc_id
          LEFT JOIN ref_sections s ON s.section_id = b.section_id
          WHERE ${where.join(" AND ")}
          ORDER BY dist ASC
          LIMIT ?`,
    args: [...args, limit],
  });

  return r.rows.map((row) => {
    const sectionHeading =
      row.section_heading == null ? null : String(row.section_heading);
    const documentTitle = String(row.doc_title);
    const pageNum = Number(row.page_num);
    return {
      blockId: String(row.block_id),
      docId: String(row.doc_id),
      documentTitle,
      sectionId: row.section_id == null ? null : String(row.section_id),
      sectionHeading,
      pageNum,
      blockType: String(row.block_type) as RefBlockType,
      text: String(row.text),
      // No FTS snippet for vector hits; fall back to first 200 chars.
      snippet: String(row.text).slice(0, 200),
      // Lower distance = better. Negate so callers sorting "ascending score"
      // get the same orientation as bm25 (where lower = better).
      score: Number(row.dist),
      citation: buildCitation(documentTitle, sectionHeading, pageNum),
    };
  });
}

export interface HybridSearchOpts {
  query: string;
  docId?: string;
  /** Top-K returned to the caller after rerank. Default 8. */
  limit?: number;
  /** How many candidates to pull from each leg before merging + reranking.
   *  Bigger = more recall, more rerank cost. Default 50. */
  candidatesPerLeg?: number;
  /** Force a specific retrieval path. Default "auto" picks based on what's
   *  available (embeddings present? Voyage key set?). */
  mode?: "auto" | "fts" | "vector" | "hybrid";
  /** Skip Voyage reranking even when available. Default false. */
  noRerank?: boolean;
}

/** Hybrid retrieval: FTS top-N ∪ vector top-N → Voyage rerank → top-K.
 *
 * Falls back gracefully:
 *   - If embeddings missing or Voyage key absent → FTS-only
 *   - If rerank API fails → return merged candidates ordered by best-of
 *     (bm25, vector_dist) without rerank
 *
 * This is the single entry point we want all retrieval to flow through. */
export async function hybridSearchRefDocs(
  opts: HybridSearchOpts,
): Promise<SearchHit[]> {
  await ensureSchema();
  const limit = Math.min(opts.limit ?? 8, 25);
  const cands = Math.min(opts.candidatesPerLeg ?? 50, 100);

  // Decide which legs to run.
  const hasVoyageKey = !!process.env.VOYAGE_API_KEY;
  const embedCheck = await client.execute(
    `SELECT COUNT(*) AS c FROM ref_blocks WHERE embedding IS NOT NULL`,
  );
  const haveEmbeddings = Number(embedCheck.rows[0].c) > 0;

  const mode: "fts" | "vector" | "hybrid" = (() => {
    if (opts.mode && opts.mode !== "auto") return opts.mode;
    if (haveEmbeddings && hasVoyageKey) return "hybrid";
    return "fts";
  })();

  // Run legs in parallel where applicable.
  const legPromises: Promise<SearchHit[]>[] = [];
  if (mode === "fts" || mode === "hybrid") {
    legPromises.push(searchRefDocs({ query: opts.query, docId: opts.docId, limit: cands }));
  }
  if (mode === "vector" || mode === "hybrid") {
    legPromises.push(
      (async () => {
        const { embedOne } = await import("../../refdocs/voyage");
        const queryVec = await embedOne(opts.query, { inputType: "query" });
        return vectorSearchRefDocs({
          queryEmbedding: queryVec,
          docId: opts.docId,
          limit: cands,
        });
      })(),
    );
  }
  const legs = await Promise.all(legPromises);

  // Merge by block_id, keeping the better score. Using a Map preserves insert
  // order; we'll re-sort below.
  const byBlock = new Map<string, SearchHit>();
  for (const leg of legs) {
    for (const hit of leg) {
      const existing = byBlock.get(hit.blockId);
      if (!existing) byBlock.set(hit.blockId, hit);
      // Don't try to merge scores between FTS bm25 and vector cosine — they
      // live in different spaces. We rely on the reranker for the final order.
    }
  }
  let candidates = Array.from(byBlock.values());

  if (candidates.length === 0) return [];

  // Rerank if we have it. Voyage rerank-2.5 takes (query, documents[]) and
  // returns relevance-ordered indices. Documents we send are the contextualized
  // text — same surface FTS/vector indexed against, so the reranker scores
  // against the same signal.
  const shouldRerank = !opts.noRerank && hasVoyageKey;
  if (shouldRerank && candidates.length > 1) {
    try {
      const { rerank } = await import("../../refdocs/voyage");
      // Need contextualized text per candidate for the reranker. Pull it.
      const placeholders = candidates.map(() => "?").join(",");
      const detail = await client.execute({
        sql: `SELECT block_id, COALESCE(contextualized_text, text) AS doc_text
              FROM ref_blocks WHERE block_id IN (${placeholders})`,
        args: candidates.map((c) => c.blockId),
      });
      const textByBlock = new Map(
        detail.rows.map((r) => [String(r.block_id), String(r.doc_text)]),
      );
      const docs = candidates.map(
        (c) => textByBlock.get(c.blockId) ?? c.text,
      );
      const ranked = await rerank(opts.query, docs, { topK: limit });
      const ordered = ranked.map((r) => {
        const base = candidates[r.index];
        return { ...base, score: r.score };
      });
      return ordered.slice(0, limit);
    } catch (err) {
      // Rerank failed — fall through to merged-without-rerank.
      console.warn(
        `[hybridSearchRefDocs] rerank failed, returning merged results: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Fallback ordering: prefer hits that appeared in both legs, then by best
  // available score. We don't try to normalize bm25 vs cosine; this is "good
  // enough until the reranker comes back."
  candidates = candidates.slice(0, limit);
  return candidates;
}

export async function getBlock(blockId: string): Promise<BlockDetail | null> {
  await ensureSchema();
  const r = await client.execute({
    sql: `SELECT
            b.block_id, b.doc_id, b.section_id, b.page_num, b.block_type,
            b.text, b.char_start, b.char_end,
            d.title AS doc_title, d.publisher, d.tax_year,
            s.heading AS section_heading
          FROM ref_blocks b
          JOIN ref_documents d ON d.doc_id = b.doc_id
          LEFT JOIN ref_sections s ON s.section_id = b.section_id
          WHERE b.block_id = ?`,
    args: [blockId],
  });
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const sectionHeading =
    row.section_heading == null ? null : String(row.section_heading);
  const documentTitle = String(row.doc_title);
  const pageNum = Number(row.page_num);
  return {
    blockId: String(row.block_id),
    docId: String(row.doc_id),
    documentTitle,
    publisher: String(row.publisher),
    taxYear: row.tax_year == null ? null : Number(row.tax_year),
    sectionId: row.section_id == null ? null : String(row.section_id),
    sectionHeading,
    pageNum,
    blockType: String(row.block_type) as RefBlockType,
    text: String(row.text),
    charStart: Number(row.char_start),
    charEnd: Number(row.char_end),
    citation: buildCitation(documentTitle, sectionHeading, pageNum),
  };
}

export async function getDocument(
  docId: string,
): Promise<RefDocument | null> {
  await ensureSchema();
  const r = await client.execute({
    sql: `SELECT * FROM ref_documents WHERE doc_id = ?`,
    args: [docId],
  });
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    docId: String(row.doc_id),
    title: String(row.title),
    publisher: String(row.publisher),
    taxYear: row.tax_year == null ? null : Number(row.tax_year),
    sourcePath: String(row.source_path),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    sha256: String(row.sha256),
    totalPages: Number(row.total_pages),
    totalChars: Number(row.total_chars),
    canonicalTextPath: String(row.canonical_text_path),
  };
}

export async function deleteDocument(docId: string): Promise<void> {
  await ensureSchema();
  // FTS5 virtual tables need explicit deletion by rowid or matching content.
  await client.batch(
    [
      { sql: `DELETE FROM ref_blocks_fts WHERE doc_id = ?`, args: [docId] },
      { sql: `DELETE FROM ref_blocks WHERE doc_id = ?`, args: [docId] },
      { sql: `DELETE FROM ref_sections WHERE doc_id = ?`, args: [docId] },
      { sql: `DELETE FROM ref_pages WHERE doc_id = ?`, args: [docId] },
      { sql: `DELETE FROM ref_documents WHERE doc_id = ?`, args: [docId] },
    ],
    "write",
  );
}

export async function setBlockEmbeddings(
  pairs: { blockId: string; embedding: number[] }[],
): Promise<void> {
  if (pairs.length === 0) return;
  await ensureSchema();
  // libsql vector literals must be in the SQL text, not bind params, so we
  // build one statement per row and submit as a single batch.
  const stmts = pairs.map((p) => ({
    sql: `UPDATE ref_blocks SET embedding = vector('${JSON.stringify(p.embedding)}') WHERE block_id = ?`,
    args: [p.blockId],
  }));
  await client.batch(stmts, "write");
}

export interface IngestPayload {
  document: RefDocument;
  pages: RefPage[];
  sections: RefSection[];
  blocks: RefBlock[];
}

// Single transaction per ingest. If we ever grow past libsql's batch size
// limits we'll chunk blocks, but ~10k blocks per IRS doc is well within.
export async function writeDocument(payload: IngestPayload): Promise<void> {
  await ensureSchema();
  const { document: d, pages, sections, blocks } = payload;
  const now = Date.now();

  const stmts: Parameters<typeof client.batch>[0] = [];

  stmts.push({
    sql: `INSERT INTO ref_documents
          (doc_id, title, publisher, tax_year, source_path, source_url, sha256,
           total_pages, total_chars, canonical_text_path, ingested_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      d.docId,
      d.title,
      d.publisher,
      d.taxYear,
      d.sourcePath,
      d.sourceUrl,
      d.sha256,
      d.totalPages,
      d.totalChars,
      d.canonicalTextPath,
      now,
    ],
  });

  for (const p of pages) {
    stmts.push({
      sql: `INSERT INTO ref_pages (doc_id, page_num, char_start, char_end) VALUES (?, ?, ?, ?)`,
      args: [p.docId, p.pageNum, p.charStart, p.charEnd],
    });
  }

  const sectionHeadingById = new Map<string, string>();
  for (const s of sections) {
    sectionHeadingById.set(s.sectionId, s.heading);
    stmts.push({
      sql: `INSERT INTO ref_sections
            (section_id, doc_id, heading, heading_slug, parent_section_id,
             ordinal, first_page, char_start, char_end)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        s.sectionId,
        s.docId,
        s.heading,
        s.headingSlug,
        s.parentSectionId,
        s.ordinal,
        s.firstPage,
        s.charStart,
        s.charEnd,
      ],
    });
  }

  for (const b of blocks) {
    // contextualized_text falls back to raw text if summarization was skipped,
    // so FTS still has something useful to index.
    const ftsText = b.contextualizedText ?? b.text;
    // Embeddings are passed via libsql's vector() function — we splice it
    // into the SQL rather than as a bind parameter because libsql vector
    // literals must be in the SQL text.
    const hasEmbedding = b.embedding != null && b.embedding.length > 0;
    const embeddingExpr = hasEmbedding ? `vector('${JSON.stringify(b.embedding)}')` : "NULL";

    stmts.push({
      sql: `INSERT INTO ref_blocks
            (block_id, doc_id, section_id, page_num, block_type, ordinal,
             text, char_start, char_end, metadata_json,
             contextual_summary, contextualized_text, block_text_sha1, embedding)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${embeddingExpr})`,
      args: [
        b.blockId,
        b.docId,
        b.sectionId,
        b.pageNum,
        b.blockType,
        b.ordinal,
        b.text,
        b.charStart,
        b.charEnd,
        b.metadata ? JSON.stringify(b.metadata) : null,
        b.contextualSummary ?? null,
        b.contextualizedText ?? null,
        b.blockTextSha1 ?? null,
      ],
    });
    stmts.push({
      sql: `INSERT INTO ref_blocks_fts
            (block_id, doc_id, section_id, page_num, section_heading, contextualized_text)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        b.blockId,
        b.docId,
        b.sectionId,
        b.pageNum,
        b.sectionId ? (sectionHeadingById.get(b.sectionId) ?? "") : "",
        ftsText,
      ],
    });
  }

  await client.batch(stmts, "write");
}
