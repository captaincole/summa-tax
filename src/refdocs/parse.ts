import type { PageSlice } from "./extract";
import type { RefBlock, RefSection } from "../mastra/db/refDocs";

// A heading detector returns the heading text if a line (given its neighbors)
// qualifies as the start of a new section. Keep the rules conservative —
// a miss degrades gracefully (content gets attached to the previous section),
// a false positive fragments the doc.
type HeadingMatch = { heading: string; slug: string };

const LINE_HEADING_RE = /^Line \d+[a-z]?$/;
// Line headings with an inline dash-delimited title, e.g. "Line 25a—Form(s) W-2".
const LINE_DASH_HEADING_RE = /^Line \d+[a-z]?—.+$/;
// Line-list headings, e.g. "Lines 27a, 27b, and 27c—" or "Lines 2a and 2b".
// The em-dash is optional; some lists leave the title to the next line.
const LINES_LIST_HEADING_RE =
  /^Lines \d+[a-z]?(?:, \d+[a-z]?)*(?:,? and \d+[a-z]?)?\s*—?$/;
// Line-range headings, e.g. "Lines 5a through 5c".
const LINES_RANGE_HEADING_RE = /^Lines \d+[a-z]? through \d+[a-z]?$/;
// Require Part/Schedule headings to appear alone on their line. Body prose
// that references a part (e.g. "Part I of Form 4797;", "Part III, line 6")
// also starts with "Part <roman>" but has trailing text on the same line,
// which we reject here.
const PART_HEADING_RE = /^Part [IVXLCDM]+$/;
const SCHEDULE_HEADING_RE = /^Schedule \d+[A-Z]?$/;

function detectHeading(line: string): HeadingMatch | null {
  const t = line.trim();
  if (
    LINE_HEADING_RE.test(t) ||
    LINE_DASH_HEADING_RE.test(t) ||
    LINES_LIST_HEADING_RE.test(t) ||
    LINES_RANGE_HEADING_RE.test(t) ||
    PART_HEADING_RE.test(t) ||
    SCHEDULE_HEADING_RE.test(t)
  ) {
    return { heading: t, slug: slugifyHeading(t) };
  }
  return null;
}

function slugifyHeading(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// IRS headings often wrap across multiple lines ("Line 1e" / "Taxable Dependent
// Care" / "Benefits From Form 2441," / "Line 26"). Without consuming the wrap,
// the last line ("Line 26") looks like a brand-new heading and creates a
// phantom section. A continuation line is a short Title Case fragment that
// doesn't end a sentence. IRS headings are consistently Title Case; body prose
// isn't, so the case test rejects things like "Each payer should send you…".
const TITLE_CASE_SMALL_WORDS = new Set([
  "of", "the", "a", "an", "and", "or", "for", "in", "on", "at", "to", "from",
  "by", "with", "as", "nor", "but", "vs",
]);

function isTitleCaseLine(t: string): boolean {
  const words = t.split(/\s+/);
  for (const w of words) {
    const bare = w.replace(/[^A-Za-z]/g, "");
    if (bare.length === 0) continue;
    if (TITLE_CASE_SMALL_WORDS.has(bare.toLowerCase())) continue;
    if (!/^[A-Z]/.test(bare)) return false;
  }
  return true;
}

function isHeadingContinuation(lineText: string): boolean {
  const t = lineText.trim();
  if (t.length === 0 || t.length > 60) return false;
  if (/[.!?]$/.test(t)) return false;
  if (/^[a-z]/.test(t)) return false;
  if (!isTitleCaseLine(t)) return false;
  return true;
}

const MAX_HEADING_CONTINUATION_LINES = 5;

// Lines we never emit into a block. These are structural PDF artifacts
// (page numbers, footer boilerplate) that show up verbatim in the canonical
// text but carry no citable content. They still live in canonical.txt;
// we just don't include them in any block's char range.
const PAGE_NUM_RE = /^\d{1,3}$/;
const FOOTER_RE = /^\d{1,3} Need more information or forms\? Visit IRS\.gov\.$/;
const HEADER_CONTINUED_RE = /^\(Continued\)$/;

function isStructuralNoise(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return true;
  if (PAGE_NUM_RE.test(t)) return true;
  if (FOOTER_RE.test(t)) return true;
  if (HEADER_CONTINUED_RE.test(t)) return true;
  return false;
}

interface LineSpan {
  text: string;
  charStart: number;
  charEnd: number; // exclusive (points at the \n or end-of-page)
}

function splitLinesWithOffsets(pageText: string, baseOffset: number): LineSpan[] {
  const out: LineSpan[] = [];
  let i = 0;
  while (i <= pageText.length) {
    const nl = pageText.indexOf("\n", i);
    const end = nl === -1 ? pageText.length : nl;
    out.push({
      text: pageText.slice(i, end),
      charStart: baseOffset + i,
      charEnd: baseOffset + end,
    });
    if (nl === -1) break;
    i = nl + 1;
  }
  return out;
}

export interface ParsedDoc {
  sections: Omit<RefSection, "docId">[];
  blocks: Omit<RefBlock, "docId">[];
}

export interface ParseOpts {
  docId: string; // used only to build ids; not returned in section/block
}

/**
 * Parse canonical text into sections and blocks.
 *
 * v1 strategy: one block per (section × page). Sections are delimited by
 * high-confidence heading lines (`Line 1a`, `Part I`, `Schedule 3`). Content
 * before the first heading falls into a synthetic "preamble" section.
 *
 * All block `text` values are verbatim slices of `canonicalText` — we don't
 * clean extraction artifacts here. Char offsets always point back to canonical.txt.
 */
export function parseDoc(
  canonicalText: string,
  pages: PageSlice[],
  opts: ParseOpts,
): ParsedDoc {
  const sections: Omit<RefSection, "docId">[] = [];
  const blocks: Omit<RefBlock, "docId">[] = [];

  const preamble: Omit<RefSection, "docId"> = {
    sectionId: `${opts.docId}::sec::preamble`,
    heading: "(Preamble)",
    headingSlug: "preamble",
    parentSectionId: null,
    ordinal: 0,
    firstPage: pages[0]?.pageNum ?? 1,
    charStart: 0,
    charEnd: 0, // filled when we close it
  };
  let currentSection = preamble;
  let sectionOrdinal = 1; // next ordinal for a new section
  let sectionsStarted = false;
  const usedSlugs = new Set<string>([preamble.headingSlug]);

  let blockOrdinal = 0;
  // Accumulator for the block currently being built within the current section on the current page.
  let pendingBlock: {
    pageNum: number;
    firstLineStart: number;
    lastLineEnd: number;
  } | null = null;

  function flushPendingBlock() {
    if (!pendingBlock) return;
    const start = pendingBlock.firstLineStart;
    const end = pendingBlock.lastLineEnd;
    if (end > start) {
      const text = canonicalText.slice(start, end);
      blocks.push({
        blockId: `${opts.docId}::p${pendingBlock.pageNum}::b${String(blockOrdinal).padStart(5, "0")}`,
        sectionId: currentSection.sectionId,
        pageNum: pendingBlock.pageNum,
        blockType: "paragraph",
        ordinal: blockOrdinal,
        text,
        charStart: start,
        charEnd: end,
      });
      blockOrdinal += 1;
    }
    pendingBlock = null;
  }

  function startSection(heading: string, slug: string, charStart: number, firstPage: number) {
    // Close out preamble or prior section.
    flushPendingBlock();
    currentSection.charEnd = charStart;
    sections.push(currentSection);
    // Disambiguate duplicate slugs by suffixing. The IRS doc reuses headings
    // like "Line 1a" across different sections (e.g. line-instruction vs.
    // a referenced use in a table caption), so we just keep incrementing.
    let uniqueSlug = slug;
    let dupe = 2;
    while (usedSlugs.has(uniqueSlug)) {
      uniqueSlug = `${slug}-${dupe++}`;
    }
    usedSlugs.add(uniqueSlug);
    currentSection = {
      sectionId: `${opts.docId}::sec::${uniqueSlug}`,
      heading,
      headingSlug: uniqueSlug,
      parentSectionId: null,
      ordinal: sectionOrdinal,
      firstPage,
      charStart,
      charEnd: charStart,
    };
    sectionOrdinal += 1;
    sectionsStarted = true;
  }

  for (const page of pages) {
    const pageText = canonicalText.slice(page.charStart, page.charEnd);
    const lines = splitLinesWithOffsets(pageText, page.charStart);

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (isStructuralNoise(line.text)) {
        i += 1;
        continue;
      }

      const heading = detectHeading(line.text);
      if (heading) {
        // Consume continuation lines that form the rest of the heading.
        const continuationTexts: string[] = [];
        let j = i + 1;
        let consumed = 0;
        let lastConsumedEnd = line.charEnd;
        while (
          j < lines.length &&
          consumed < MAX_HEADING_CONTINUATION_LINES &&
          !isStructuralNoise(lines[j].text) &&
          isHeadingContinuation(lines[j].text)
        ) {
          continuationTexts.push(lines[j].text.trim());
          lastConsumedEnd = lines[j].charEnd;
          j += 1;
          consumed += 1;
        }
        const fullHeading =
          continuationTexts.length === 0
            ? heading.heading
            : `${heading.heading} ${continuationTexts.join(" ")}`;

        startSection(
          fullHeading,
          heading.slug,
          line.charStart,
          page.pageNum,
        );

        // Body starts after the heading (including any continuation).
        const bodyStart = lastConsumedEnd;
        pendingBlock = {
          pageNum: page.pageNum,
          firstLineStart: bodyStart,
          lastLineEnd: bodyStart,
        };
        i = j;
        continue;
      }

      // Regular content line. Extend the pending block, or open one on this page.
      if (!pendingBlock || pendingBlock.pageNum !== page.pageNum) {
        flushPendingBlock();
        pendingBlock = {
          pageNum: page.pageNum,
          firstLineStart: line.charStart,
          lastLineEnd: line.charEnd,
        };
      } else {
        pendingBlock.lastLineEnd = line.charEnd;
      }
      i += 1;
    }

    // End of page: flush so the next page gets its own block.
    flushPendingBlock();
  }

  // Close the final section.
  currentSection.charEnd = canonicalText.length;
  sections.push(currentSection);

  // If no real sections were found, the preamble covered the whole doc.
  // Leave it as-is; it's still a valid single-section parse.
  if (!sectionsStarted && sections.length === 1) {
    // preamble already in sections with full range — no-op
  }

  return { sections, blocks };
}
