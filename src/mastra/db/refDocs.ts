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

      // FTS5 index over block text. Porter stemming + unicode61 tokenizer handles
      // IRS prose well; we keep doc_id/section_id UNINDEXED so we can filter
      // search results by document or narrow to a section.
      await client.execute(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ref_blocks_fts USING fts5(
          block_id UNINDEXED,
          doc_id UNINDEXED,
          section_id UNINDEXED,
          page_num UNINDEXED,
          section_heading,
          text,
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
    stmts.push({
      sql: `INSERT INTO ref_blocks
            (block_id, doc_id, section_id, page_num, block_type, ordinal,
             text, char_start, char_end, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ],
    });
    stmts.push({
      sql: `INSERT INTO ref_blocks_fts
            (block_id, doc_id, section_id, page_num, section_heading, text)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        b.blockId,
        b.docId,
        b.sectionId,
        b.pageNum,
        b.sectionId ? (sectionHeadingById.get(b.sectionId) ?? "") : "",
        b.text,
      ],
    });
  }

  await client.batch(stmts, "write");
}
