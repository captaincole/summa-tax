import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extractText } from "unpdf";

export const PAGE_SEPARATOR = "\n\n\f\n\n";

export interface PageSlice {
  pageNum: number;
  charStart: number;
  charEnd: number;
}

export interface ExtractedPdf {
  canonicalText: string;
  pages: PageSlice[];
  totalPages: number;
  sha256: string;
}

export async function extractPdf(path: string): Promise<ExtractedPdf> {
  const buf = await readFile(path);
  const sha256 = createHash("sha256").update(buf).digest("hex");

  const { totalPages, text: pageTexts } = await extractText(
    new Uint8Array(buf),
    { mergePages: false },
  );

  const pages: PageSlice[] = [];
  const chunks: string[] = [];
  let cursor = 0;
  for (let i = 0; i < pageTexts.length; i++) {
    const pageText = pageTexts[i];
    const start = cursor;
    chunks.push(pageText);
    cursor += pageText.length;
    pages.push({ pageNum: i + 1, charStart: start, charEnd: cursor });
    if (i < pageTexts.length - 1) {
      chunks.push(PAGE_SEPARATOR);
      cursor += PAGE_SEPARATOR.length;
    }
  }

  return {
    canonicalText: chunks.join(""),
    pages,
    totalPages,
    sha256,
  };
}
