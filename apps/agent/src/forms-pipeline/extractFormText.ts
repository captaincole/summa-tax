// Per-page text extraction. Used as context for the Claude classification
// step — we send the page's rendered text alongside each widget so Claude
// can match `f1_47 at (x, y) on page 1` to the corresponding line label
// ("Total amount from Form(s) W-2, box 1").
//
// Thin wrapper over unpdf so the call-site doesn't need to know about
// mergePages: false semantics. Mirrors the refdocs/extract.ts approach
// but returns per-page strings instead of a canonical concatenation.

import { readFile } from "node:fs/promises";
import { extractText } from "unpdf";

export interface FormPage {
  /** 0-indexed to match extractAcroForm's `page` field. */
  page: number;
  text: string;
}

export async function extractFormText(pdfPath: string): Promise<FormPage[]> {
  const buf = await readFile(pdfPath);
  const { text: pageTexts } = await extractText(new Uint8Array(buf), {
    mergePages: false,
  });
  return pageTexts.map((text, i) => ({ page: i, text }));
}
