import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { extractPdf } from "./extract";
import { parseDoc } from "./parse";
import { summarizeBlocks, sha1 } from "./contextualize";
import { embed, batchByLimits } from "./voyage";
import {
  deleteDocument,
  getDocument,
  setBlockEmbeddings,
  writeDocument,
  type RefBlock,
  type RefPage,
  type RefSection,
} from "../mastra/db/refDocs";

export interface IngestInput {
  pdfPath: string;
  docId: string;
  title: string;
  publisher: string;
  taxYear: number | null;
  sourceUrl?: string | null;
  canonicalOutDir: string;
  force?: boolean;
  /** Skip the per-block Haiku contextualization step. Useful for fast dev
   *  iteration where you only care about the parser. Without contextualization
   *  the embedding step still runs against raw block text. */
  noContextualize?: boolean;
  /** Skip the Voyage embedding step. Set automatically when VOYAGE_API_KEY is
   *  not present, so the system gracefully degrades to FTS-only retrieval. */
  noEmbed?: boolean;
}

export interface IngestResult {
  docId: string;
  sha256: string;
  totalPages: number;
  totalChars: number;
  sectionCount: number;
  blockCount: number;
  canonicalTextPath: string;
  replaced: boolean;
  contextualized: boolean;
  embedded: boolean;
}

export async function ingestRefDoc(input: IngestInput): Promise<IngestResult> {
  const pdfPath = resolve(input.pdfPath);
  const canonicalOutDir = resolve(input.canonicalOutDir);

  const extracted = await extractPdf(pdfPath);

  const existing = await getDocument(input.docId);
  let replaced = false;
  if (existing) {
    if (existing.sha256 === extracted.sha256 && !input.force) {
      throw new Error(
        `doc_id '${input.docId}' already ingested at same sha256. Pass --force to re-ingest.`,
      );
    }
    await deleteDocument(input.docId);
    replaced = true;
  }

  const canonicalTextPath = `${canonicalOutDir}/${input.docId}.canonical.txt`;
  await mkdir(dirname(canonicalTextPath), { recursive: true });
  await writeFile(canonicalTextPath, extracted.canonicalText, "utf8");

  const { sections: parsedSections, blocks: parsedBlocks } = parseDoc(
    extracted.canonicalText,
    extracted.pages,
    { docId: input.docId },
  );

  const pages: RefPage[] = extracted.pages.map((p) => ({
    docId: input.docId,
    pageNum: p.pageNum,
    charStart: p.charStart,
    charEnd: p.charEnd,
  }));

  const sections: RefSection[] = parsedSections.map((s) => ({
    docId: input.docId,
    ...s,
  }));

  const blocks: RefBlock[] = parsedBlocks.map((b) => ({
    docId: input.docId,
    ...b,
  }));

  // Contextual Retrieval: per-block Haiku summary, prepended before embedding/FTS.
  // We pass the SECTION text (not the whole doc) as the cached prefix — large
  // reference docs blow Haiku's 200k context window. Cache-by-section gives
  // the same per-call discount within a section while scaling to any doc size.
  if (!input.noContextualize) {
    const start = Date.now();
    const sectionTextById = new Map<string, string>();
    const sectionHeadingById = new Map<string, string>();
    for (const s of sections) {
      sectionTextById.set(
        s.sectionId,
        extracted.canonicalText.slice(s.charStart, s.charEnd),
      );
      sectionHeadingById.set(s.sectionId, s.heading);
    }

    const summarized = await summarizeBlocks({
      documentTitle: input.title,
      blocks: blocks.map((b) => {
        const sectionText = b.sectionId
          ? (sectionTextById.get(b.sectionId) ?? b.text)
          : b.text;
        const sectionHeading = b.sectionId
          ? (sectionHeadingById.get(b.sectionId) ?? null)
          : null;
        return {
          blockId: b.blockId,
          text: b.text,
          sectionHeading,
          sectionText,
        };
      }),
      concurrency: 5,
      onProgress: (done, total) => {
        if (done === 1 || done % 25 === 0 || done === total) {
          console.log(`  contextualizing ${done}/${total} blocks…`);
        }
      },
    });
    const byId = new Map(summarized.map((s) => [s.blockId, s]));
    for (const b of blocks) {
      const s = byId.get(b.blockId);
      if (!s) continue;
      b.contextualSummary = s.summary;
      b.contextualizedText = s.contextualizedText;
      b.blockTextSha1 = s.blockTextSha1;
    }
    console.log(
      `  contextualization done in ${Math.round((Date.now() - start) / 1000)}s`,
    );
  } else {
    // Still hash the text so the column has something to compare against on
    // a future re-ingest that does run summarization.
    for (const b of blocks) b.blockTextSha1 = sha1(b.text);
  }

  // Embedding step. Voyage embeds the contextualized text (summary + raw text).
  // If the API key isn't configured, we silently skip — the system falls back
  // to FTS-only at query time, and a future re-ingest with the key set will
  // populate the column.
  // Write the document + blocks now (before embedding). This way a crash in
  // the embed step doesn't lose the contextual summaries we just paid Haiku
  // to generate — we update embeddings in place afterward.
  await writeDocument({
    document: {
      docId: input.docId,
      title: input.title,
      publisher: input.publisher,
      taxYear: input.taxYear,
      sourcePath: pdfPath,
      sourceUrl: input.sourceUrl ?? null,
      sha256: extracted.sha256,
      totalPages: extracted.totalPages,
      totalChars: extracted.canonicalText.length,
      canonicalTextPath,
    },
    pages,
    sections,
    blocks,
  });

  // Embed AFTER writing rows so a mid-embed crash doesn't lose summaries.
  // Uses UPDATE rather than re-INSERT.
  const shouldEmbed = !input.noEmbed && !!process.env.VOYAGE_API_KEY;
  if (shouldEmbed) {
    const start = Date.now();
    const inputs = blocks.map((b) => b.contextualizedText ?? b.text);
    const batches = batchByLimits(inputs);
    const vectors: number[][] = [];
    let processed = 0;
    for (const batch of batches) {
      const batchVecs = await embed(batch, { inputType: "document" });
      vectors.push(...batchVecs);
      processed += batch.length;
      console.log(`  embedding ${processed}/${inputs.length} blocks…`);
    }
    await setBlockEmbeddings(
      blocks.map((b, i) => ({ blockId: b.blockId, embedding: vectors[i] })),
    );
    console.log(
      `  embedding done in ${Math.round((Date.now() - start) / 1000)}s`,
    );
  } else if (!input.noEmbed) {
    console.log(
      "  (VOYAGE_API_KEY not set — skipping embeddings; system will use FTS-only)",
    );
  }

  return {
    docId: input.docId,
    sha256: extracted.sha256,
    totalPages: extracted.totalPages,
    totalChars: extracted.canonicalText.length,
    sectionCount: sections.length,
    blockCount: blocks.length,
    canonicalTextPath,
    replaced,
    contextualized: !input.noContextualize,
    embedded: shouldEmbed,
  };
}
