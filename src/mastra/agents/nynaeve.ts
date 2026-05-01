import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { searchRefDocsTool, citeRefDocTool } from "../tools/refDocs";
import { nynaeveInstructions } from "./nynaeve.instructions";

export const nynaeveReviewSchema = z.object({
  verdict: z.enum(["accurate", "inaccurate", "ungroundable"]),
  reason: z
    .string()
    .describe(
      "Specific, auditable explanation — reference concrete fact keys or reference passages.",
    ),
  citations: z
    .array(
      z.object({
        blockId: z
          .string()
          .describe(
            "blockId from a search-ref-docs or cite-ref-docs result. Required.",
          ),
        quote: z
          .string()
          .optional()
          .describe(
            "Optional exact phrase from the passage that supports the decision. Short.",
          ),
      }),
    )
    .describe(
      "Empty array if verdict is inaccurate or ungroundable; one or more blocks if accurate.",
    ),
});

export type NynaeveReview = z.infer<typeof nynaeveReviewSchema>;

export const nynaeve = new Agent({
  id: "nynaeve",
  name: "Nynaeve al'Meara",
  instructions: nynaeveInstructions,
  model: "anthropic/claude-haiku-4-5",
  tools: {
    searchRefDocs: searchRefDocsTool,
    citeRefDoc: citeRefDocTool,
  },
});
