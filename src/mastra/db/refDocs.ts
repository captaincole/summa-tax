import { getServiceRoleClient } from "./supabase";

// ---------------------------------------------------------------------------
// Public types — preserved verbatim from the libsql version so consumers
// (src/mastra/tools/refDocs.ts, src/refdocs/ingest.ts, smoke scripts) need no
// changes.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// pgvector accepts both array and text formats, but PostgREST's JSON pipeline
// is most reliable when we serialize to the canonical "[1,2,3]" string form.
function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// Supabase errors are plain objects, not Error instances. Wrap them so the
// stack trace lands at the call site and our top-level catch (sync script,
// Mastra tool layer) sees a real Error with useful context.
function assertOk(
  result: { error: { message?: string; details?: string; hint?: string; code?: string } | null },
  context: string,
): void {
  if (!result.error) return;
  const e = result.error;
  const parts = [`${context}: ${e.message ?? "supabase error"}`];
  if (e.code) parts.push(`code=${e.code}`);
  if (e.details) parts.push(`details=${e.details}`);
  if (e.hint) parts.push(`hint=${e.hint}`);
  throw new Error(parts.join(" "));
}

// ---------------------------------------------------------------------------
// Single-row lookups
// ---------------------------------------------------------------------------

export async function getDocument(
  docId: string,
): Promise<RefDocument | null> {
  const { data, error } = await getServiceRoleClient()
    .from("ref_documents")
    .select(
      "doc_id, title, publisher, tax_year, source_path, source_url, sha256, total_pages, total_chars, canonical_text_path",
    )
    .eq("doc_id", docId)
    .maybeSingle();
  assertOk({ error }, "getDocument");
  if (!data) return null;
  return {
    docId: data.doc_id,
    title: data.title,
    publisher: data.publisher,
    taxYear: data.tax_year,
    sourcePath: data.source_path,
    sourceUrl: data.source_url,
    sha256: data.sha256,
    totalPages: data.total_pages,
    totalChars: data.total_chars,
    canonicalTextPath: data.canonical_text_path,
  };
}

export async function getBlock(blockId: string): Promise<BlockDetail | null> {
  // PostgREST embedded-resource syntax: pulls related rows via the FK columns
  // we declared in the migration.
  const { data, error } = await getServiceRoleClient()
    .from("ref_blocks")
    .select(
      `block_id, doc_id, section_id, page_num, block_type, text, char_start, char_end,
       doc:ref_documents (title, publisher, tax_year),
       section:ref_sections (heading)`,
    )
    .eq("block_id", blockId)
    .maybeSingle();
  assertOk({ error }, "getBlock");
  if (!data) return null;
  // PostgREST returns embedded resources as arrays when the relation is to-many,
  // single objects when to-one. Both our embeds are to-one but the type system
  // can't always tell — coerce defensively.
  const doc = Array.isArray(data.doc) ? data.doc[0] : data.doc;
  const section = Array.isArray(data.section) ? data.section[0] : data.section;
  const documentTitle = doc?.title ?? "(unknown)";
  const sectionHeading = section?.heading ?? null;
  const pageNum = data.page_num;
  return {
    blockId: data.block_id,
    docId: data.doc_id,
    documentTitle,
    publisher: doc?.publisher ?? "(unknown)",
    taxYear: doc?.tax_year ?? null,
    sectionId: data.section_id,
    sectionHeading,
    pageNum,
    blockType: data.block_type as RefBlockType,
    text: data.text,
    charStart: data.char_start,
    charEnd: data.char_end,
    citation: buildCitation(documentTitle, sectionHeading, pageNum),
  };
}

// ---------------------------------------------------------------------------
// Hybrid retrieval — calls match_ref_blocks() RPC, optionally reranks via Voyage.
// FTS-only and vector-only paths reduce to the same RPC with one input nulled.
// ---------------------------------------------------------------------------

interface MatchRow {
  block_id: string;
  doc_id: string;
  section_id: string | null;
  page_num: number;
  block_type: string;
  text: string;
  contextualized_text: string | null;
  doc_title: string;
  section_heading: string | null;
  fts_rank: number | null;
  vector_distance: number | null;
}

function rowToHit(row: MatchRow, score: number): SearchHit {
  return {
    blockId: row.block_id,
    docId: row.doc_id,
    documentTitle: row.doc_title,
    sectionId: row.section_id,
    sectionHeading: row.section_heading,
    pageNum: row.page_num,
    blockType: row.block_type as RefBlockType,
    text: row.text,
    snippet: row.text.slice(0, 200),
    score,
    citation: buildCitation(row.doc_title, row.section_heading, row.page_num),
  };
}

async function callMatch(args: {
  queryText: string | null;
  queryEmbedding: number[] | null;
  matchCount: number;
  filterDocId?: string;
}): Promise<MatchRow[]> {
  const { data, error } = await getServiceRoleClient().rpc("match_ref_blocks", {
    query_text: args.queryText,
    query_embedding: args.queryEmbedding ? vectorLiteral(args.queryEmbedding) : null,
    match_count: args.matchCount,
    filter_doc_id: args.filterDocId ?? null,
  });
  assertOk({ error }, "match_ref_blocks");
  return (data ?? []) as MatchRow[];
}

export interface SearchOpts {
  query: string;
  docId?: string;
  limit?: number;
}

/** FTS-only search. Kept for the migration-test scripts; new callers should
 *  prefer hybridSearchRefDocs. */
export async function searchRefDocs(opts: SearchOpts): Promise<SearchHit[]> {
  const limit = Math.min(opts.limit ?? 5, 25);
  const rows = await callMatch({
    queryText: opts.query,
    queryEmbedding: null,
    matchCount: limit,
    filterDocId: opts.docId,
  });
  return rows
    .filter((r) => r.fts_rank != null)
    // ts_rank_cd: higher = better. Sort descending; expose negative for the
    // "lower = better" orientation the legacy bm25 score had. We only flip
    // direction here because hybridSearchRefDocs's fallback assumes score
    // monotone with relevance after rerank — direct callers of searchRefDocs
    // (smoke scripts) just want "best first".
    .sort((a, b) => (b.fts_rank ?? 0) - (a.fts_rank ?? 0))
    .slice(0, limit)
    .map((r) => rowToHit(r, -(r.fts_rank ?? 0)));
}

export interface VectorSearchOpts {
  queryEmbedding: number[];
  docId?: string;
  limit?: number;
}

/** Vector-only search. Kept for compareRetrieval.ts evals. */
export async function vectorSearchRefDocs(
  opts: VectorSearchOpts,
): Promise<SearchHit[]> {
  const limit = Math.min(opts.limit ?? 5, 50);
  const rows = await callMatch({
    queryText: null,
    queryEmbedding: opts.queryEmbedding,
    matchCount: limit,
    filterDocId: opts.docId,
  });
  return rows
    .filter((r) => r.vector_distance != null)
    .sort((a, b) => (a.vector_distance ?? 0) - (b.vector_distance ?? 0))
    .slice(0, limit)
    .map((r) => rowToHit(r, r.vector_distance ?? 0));
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
   *  available (Voyage key set?). */
  mode?: "auto" | "fts" | "vector" | "hybrid";
  /** Skip Voyage reranking even when available. Default false. */
  noRerank?: boolean;
}

/** Hybrid retrieval: FTS top-N ∪ vector top-N → Voyage rerank → top-K.
 *
 * Falls back gracefully:
 *   - If Voyage key absent → FTS-only via the same RPC (vector leg returns no
 *     rows because we pass query_embedding=null)
 *   - If rerank fails → return merged candidates ordered by best-of-leg
 *     (we don't try to normalize ts_rank vs cosine; rerank is the proper fix)
 */
export async function hybridSearchRefDocs(
  opts: HybridSearchOpts,
): Promise<SearchHit[]> {
  const limit = Math.min(opts.limit ?? 8, 25);
  const cands = Math.min(opts.candidatesPerLeg ?? 50, 100);

  const hasVoyageKey = !!process.env.VOYAGE_API_KEY;
  const mode: "fts" | "vector" | "hybrid" = (() => {
    if (opts.mode && opts.mode !== "auto") return opts.mode;
    return hasVoyageKey ? "hybrid" : "fts";
  })();

  // Embed the query if we're going to use the vector leg.
  let queryEmbedding: number[] | null = null;
  if ((mode === "vector" || mode === "hybrid") && hasVoyageKey) {
    const { embedOne } = await import("../../refdocs/voyage");
    queryEmbedding = await embedOne(opts.query, { inputType: "query" });
  }

  const rows = await callMatch({
    queryText: mode === "vector" ? null : opts.query,
    queryEmbedding: mode === "fts" ? null : queryEmbedding,
    matchCount: cands,
    filterDocId: opts.docId,
  });
  if (rows.length === 0) return [];

  // Rerank if we have it. Voyage rerank-2.5 takes (query, documents[]) and
  // returns relevance-ordered indices. We send the contextualized text — the
  // same surface FTS/vector indexed against, so the reranker's signal aligns.
  const shouldRerank = !opts.noRerank && hasVoyageKey && rows.length > 1;
  if (shouldRerank) {
    try {
      const { rerank } = await import("../../refdocs/voyage");
      const docs = rows.map((r) => r.contextualized_text ?? r.text);
      const ranked = await rerank(opts.query, docs, { topK: limit });
      return ranked
        .map((r) => rowToHit(rows[r.index], r.score))
        .slice(0, limit);
    } catch (err) {
      console.warn(
        `[hybridSearchRefDocs] rerank failed, returning merged results: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Fallback ordering: blocks that hit both legs first, then by best signal.
  // We don't try to normalize ts_rank vs cosine — rerank is the right fix.
  const scored = rows
    .map((r) => {
      const ftsScore = r.fts_rank ?? 0;
      const vecScore = r.vector_distance != null ? 1 / (1 + r.vector_distance) : 0;
      const bothLegs = r.fts_rank != null && r.vector_distance != null ? 1 : 0;
      return { row: r, score: bothLegs + Math.max(ftsScore, vecScore) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ row, score }) => rowToHit(row, score));
}

// ---------------------------------------------------------------------------
// Mutations — used by the ingest pipeline.
// ---------------------------------------------------------------------------

export async function deleteDocument(docId: string): Promise<void> {
  // FK ON DELETE CASCADE on ref_pages/ref_sections/ref_blocks handles children.
  const { error } = await getServiceRoleClient()
    .from("ref_documents")
    .delete()
    .eq("doc_id", docId);
  assertOk({ error }, "deleteDocument");
}

export async function setBlockEmbeddings(
  pairs: { blockId: string; embedding: number[] }[],
): Promise<void> {
  if (pairs.length === 0) return;
  // Per-row UPDATE. upsert() would be batchier but PostgREST validates NOT NULL
  // columns on the INSERT side of upsert even when conflict is detected, so we
  // can't ship just (block_id, embedding). The right fix is a Postgres RPC
  // taking jsonb pairs; we'll add it if 383 rows × ~50ms ever becomes the
  // bottleneck. Today it's ~10s per ingest, fine.
  const supabase = getServiceRoleClient();
  const CONCURRENCY = 10;
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= pairs.length) return;
      const p = pairs[i];
      const { error } = await supabase
        .from("ref_blocks")
        .update({ embedding: vectorLiteral(p.embedding) })
        .eq("block_id", p.blockId);
      assertOk({ error }, `setBlockEmbeddings[${p.blockId}]`);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pairs.length) }, () => worker()),
  );
}

export interface IngestPayload {
  document: RefDocument;
  pages: RefPage[];
  sections: RefSection[];
  blocks: RefBlock[];
}

/** Writes a full document tree. Not atomic across tables — callers should
 *  call deleteDocument() first if replacing, and re-run on partial failure
 *  (the FK cascade cleans up orphans on the next delete). */
export async function writeDocument(payload: IngestPayload): Promise<void> {
  const { document: d, pages, sections, blocks } = payload;
  const supabase = getServiceRoleClient();

  // 1) document
  {
    const { error } = await supabase.from("ref_documents").insert({
      doc_id: d.docId,
      title: d.title,
      publisher: d.publisher,
      tax_year: d.taxYear,
      source_path: d.sourcePath,
      source_url: d.sourceUrl,
      sha256: d.sha256,
      total_pages: d.totalPages,
      total_chars: d.totalChars,
      canonical_text_path: d.canonicalTextPath,
    });
    assertOk({ error }, "writeDocument");
  }

  // 2) pages — chunked to avoid blowing PostgREST's request size on big docs.
  const PAGE_CHUNK = 500;
  for (let i = 0; i < pages.length; i += PAGE_CHUNK) {
    const slice = pages.slice(i, i + PAGE_CHUNK);
    const { error } = await supabase.from("ref_pages").insert(
      slice.map((p) => ({
        doc_id: p.docId,
        page_num: p.pageNum,
        char_start: p.charStart,
        char_end: p.charEnd,
      })),
    );
    assertOk({ error }, "writeDocument");
  }

  // 3) sections
  const SECTION_CHUNK = 500;
  for (let i = 0; i < sections.length; i += SECTION_CHUNK) {
    const slice = sections.slice(i, i + SECTION_CHUNK);
    const { error } = await supabase.from("ref_sections").insert(
      slice.map((s) => ({
        section_id: s.sectionId,
        doc_id: s.docId,
        heading: s.heading,
        heading_slug: s.headingSlug,
        parent_section_id: s.parentSectionId,
        ordinal: s.ordinal,
        first_page: s.firstPage,
        char_start: s.charStart,
        char_end: s.charEnd,
      })),
    );
    assertOk({ error }, "writeDocument");
  }

  // 4) blocks — biggest table, smaller chunk size to stay safe under request
  // limits when blocks carry full text + embedding.
  const BLOCK_CHUNK = 100;
  for (let i = 0; i < blocks.length; i += BLOCK_CHUNK) {
    const slice = blocks.slice(i, i + BLOCK_CHUNK);
    const { error } = await supabase.from("ref_blocks").insert(
      slice.map((b) => ({
        block_id: b.blockId,
        doc_id: b.docId,
        section_id: b.sectionId,
        page_num: b.pageNum,
        block_type: b.blockType,
        ordinal: b.ordinal,
        text: b.text,
        char_start: b.charStart,
        char_end: b.charEnd,
        metadata_json: b.metadata ?? null,
        contextual_summary: b.contextualSummary ?? null,
        contextualized_text: b.contextualizedText ?? null,
        block_text_sha1: b.blockTextSha1 ?? null,
        embedding:
          b.embedding && b.embedding.length > 0
            ? vectorLiteral(b.embedding)
            : null,
      })),
    );
    assertOk({ error }, "writeDocument");
  }
}
