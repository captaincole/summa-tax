import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { hybridSearchRefDocs, getBlock } from "../db/refDocs";

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
    "Search the ingested reference-document corpus (IRS instructions, pubs, etc.). Uses hybrid retrieval (lexical FTS + local semantic vector search) — the system gracefully falls back to keyword-only search if the local embedding model is unavailable. Pass a natural-language query with the key terms (e.g. 'household employee wages reporting', 'standard deduction single filer 2025'). Each hit includes a block_id that can be resolved to exact text via cite-ref-docs.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "Natural-language query. Phrase it naturally — semantic search will bridge vocabulary gaps. Key terms still help.",
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
      .describe("Max hits to return (default 8)."),
    mode: z
      .enum(["auto", "fts", "vector", "hybrid"])
      .optional()
      .describe(
        "Retrieval mode. Default 'auto' runs hybrid (FTS + vector), degrading to FTS-only when the local embedding model is unavailable. Override only for evals/debugging.",
      ),
  }),
  outputSchema: z.object({
    query: z.string(),
    results: z.array(searchHitSchema),
  }),
  execute: async (input) => {
    const results = await hybridSearchRefDocs({
      query: input.query,
      docId: input.docId,
      limit: input.limit,
      mode: input.mode,
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
