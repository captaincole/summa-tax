import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { searchRefDocs, getBlock } from "../db/refDocs";

const searchHitSchema = z.object({
  blockId: z.string(),
  docId: z.string(),
  documentTitle: z.string(),
  sectionId: z.string().nullable(),
  sectionHeading: z.string().nullable(),
  pageNum: z.number(),
  blockType: z.string(),
  snippet: z.string(),
  text: z.string(),
  score: z.number(),
  citation: z.string(),
});

export const searchRefDocsTool = createTool({
  id: "search-ref-docs",
  description:
    "Search the ingested reference-document corpus (IRS instructions, pubs, etc.) via full-text search. Returns the top-matching blocks ranked by BM25. Use this to find the passage that supports a decision — pass a natural-language query with the key terms (e.g. 'household employee wages reporting', 'standard deduction single filer 2025'). Each hit includes a block_id that can be resolved to exact text via cite-ref-docs.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "Natural-language query. Key terms matter most — e.g. 'qualified dividends Line 3a' or 'medicaid waiver payments exclusion'.",
      ),
    docId: z
      .string()
      .optional()
      .describe(
        "Optional: restrict search to a specific document id (e.g. 'irs-1040-inst-2025').",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe("Max hits to return (default 5)."),
  }),
  outputSchema: z.object({
    query: z.string(),
    results: z.array(searchHitSchema),
  }),
  execute: async (input) => {
    const results = await searchRefDocs({
      query: input.query,
      docId: input.docId,
      limit: input.limit,
    });
    return { query: input.query, results };
  },
});

export const citeRefDocTool = createTool({
  id: "cite-ref-docs",
  description:
    "Fetch the verbatim text and human-readable citation for a reference-document block by its block_id. Call this after search-ref-docs once you've identified the block you want to cite. The returned text is the exact source; quote from it directly rather than paraphrasing.",
  inputSchema: z.object({
    blockId: z
      .string()
      .describe(
        "Stable block id returned by search-ref-docs (e.g. 'irs-1040-inst-2025::p24::b00025').",
      ),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    block: z
      .object({
        blockId: z.string(),
        docId: z.string(),
        documentTitle: z.string(),
        publisher: z.string(),
        taxYear: z.number().nullable(),
        sectionId: z.string().nullable(),
        sectionHeading: z.string().nullable(),
        pageNum: z.number(),
        blockType: z.string(),
        text: z.string(),
        citation: z.string(),
      })
      .nullable(),
  }),
  execute: async (input) => {
    const block = await getBlock(input.blockId);
    if (!block) return { found: false, block: null };
    return {
      found: true,
      block: {
        blockId: block.blockId,
        docId: block.docId,
        documentTitle: block.documentTitle,
        publisher: block.publisher,
        taxYear: block.taxYear,
        sectionId: block.sectionId,
        sectionHeading: block.sectionHeading,
        pageNum: block.pageNum,
        blockType: block.blockType,
        text: block.text,
        citation: block.citation,
      },
    };
  },
});
