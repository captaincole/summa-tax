import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { extractPdf } from "./extract";
import { parseDoc, type ParserStyle } from "./parse";
import { summarizeBlocks, sha1 } from "./contextualize";
import { resolveEmbeddings, embedDocuments } from "./embeddings";
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
  force?: boolean;
  /** Skip the per-block Haiku contextualization step. Useful for fast dev
   *  iteration where you only care about the parser. Without contextualization
   *  the embedding step still runs against raw block text. */
  noContextualize?: boolean;
  /** Skip the embedding step entirely (fast parser-only iteration). An
   *  unreachable Ollama is handled separately: the embed step fails soft and
   *  the system degrades to FTS-only retrieval until `corpus reembed`. */
  noEmbed?: boolean;
  /** Heading-detection profile. Defaults to "irs"; FTB-published docs (e.g.
   *  Schedule CA instructions) need "ftb" for their en-dash inline-body
   *  convention. See `ParserStyle` in `./parse`. */
  parserStyle?: ParserStyle;
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
  /** True when the on-disk PDF's sha matches the existing ref_documents row,
   *  so we returned without re-running extract / contextualize / embed. The
   *  rest of the result fields are pulled from the existing row in this case. */
  skipped: boolean;
}

async function shaOfFile(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

export async function ingestRefDoc(input: IngestInput): Promise<IngestResult> {
  const pdfPath = resolve(input.pdfPath);
  // Canonical text colocates with its source PDF: forms/<…>/instructions.pdf
  // → forms/<…>/instructions.canonical.txt. Same dir, same basename, .canonical.txt extension.
  const canonicalTextPath = pdfPath.replace(/\.pdf$/i, ".canonical.txt");

  // Sha-skip: hash the file before any expensive step. If the existing row's
  // sha matches and the caller didn't pass --force, we have nothing to do.
  // This is what makes `corpus sync` cheap to run on every dev tick.
  const fileSha = await shaOfFile(pdfPath);
  const existing = await getDocument(input.docId);
  if (existing && existing.sha256 === fileSha && !input.force) {
    console.log(
      `  ${input.docId}: sha unchanged (${fileSha.slice(0, 12)}…), skipping ingest`,
    );
    return {
      docId: existing.docId,
      sha256: existing.sha256,
      totalPages: existing.totalPages,
      totalChars: existing.totalChars,
      // We don't know section/block counts without a query; callers that care
      // can run the search smoke test instead. Return -1 to make this loud.
      sectionCount: -1,
      blockCount: -1,
      canonicalTextPath: existing.canonicalTextPath,
      replaced: false,
      contextualized: false,
      embedded: false,
      skipped: true,
    };
  }

  const extracted = await extractPdf(pdfPath);

  let replaced = false;
  if (existing) {
    await deleteDocument(input.docId);
    replaced = true;
  }

  await mkdir(dirname(canonicalTextPath), { recursive: true });
  await writeFile(canonicalTextPath, extracted.canonicalText, "utf8");

  const { sections: parsedSections, blocks: parsedBlocks } = parseDoc(
    extracted.canonicalText,
    extracted.pages,
    { docId: input.docId, style: input.parserStyle },
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

  // Embed AFTER writing rows so an embed failure (e.g. Ollama not running)
  // doesn't lose the contextual summaries we just paid for. Fails soft:
  // rows keep NULL embeddings, retrieval runs FTS-only, and
  // `npm run corpus -- reembed` finishes the job once Ollama is up.
  let embedded = false;
  if (!input.noEmbed) {
    try {
      const embedCfg = resolveEmbeddings();
      const start = Date.now();
      const inputs = blocks.map((b) => b.contextualizedText ?? b.text);
      const vectors = await embedDocuments(embedCfg, inputs, (done, total) =>
        console.log(`  embedding ${done}/${total} blocks… (${embedCfg.id})`),
      );
      await setBlockEmbeddings(
        blocks.map((b, i) => ({ blockId: b.blockId, embedding: vectors[i] })),
        { embeddingModel: embedCfg.id },
      );
      embedded = true;
      console.log(
        `  embedding done in ${Math.round((Date.now() - start) / 1000)}s`,
      );
    } catch (err) {
      console.warn(
        `  (embedding skipped — ${err instanceof Error ? err.message : String(err)}\n` +
          `   retrieval will be FTS-only; run \`npm run corpus -- reembed\` once Ollama is up)`,
      );
    }
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
    embedded,
    skipped: false,
  };
}
