import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { extractPdf } from "./extract";
import { parseDoc } from "./parse";
import {
  deleteDocument,
  getDocument,
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

  return {
    docId: input.docId,
    sha256: extracted.sha256,
    totalPages: extracted.totalPages,
    totalChars: extracted.canonicalText.length,
    sectionCount: sections.length,
    blockCount: blocks.length,
    canonicalTextPath,
    replaced,
  };
}
