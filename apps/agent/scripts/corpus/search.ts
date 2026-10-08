// Invoke the search-ref-docs Mastra tool directly — same code path the review
// workflow uses during a review. Lets you eyeball what it'd see for a query.

import { parseArgs } from "node:util";
import { searchRefDocsTool } from "../../src/mastra/tools/refDocs";
import type { Command } from "../lib/cli";

async function run(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      limit: { type: "string", default: "5" },
      mode: { type: "string", default: "auto" },
      "doc-id": { type: "string" },
    },
    allowPositionals: true,
  });
  const query = positionals.join(" ").trim();
  if (!query) {
    console.error('required: a query string (see --help)');
    process.exit(1);
  }

  const result = await (searchRefDocsTool as unknown as {
    execute: (input: {
      query: string;
      limit?: number;
      mode?: "auto" | "fts" | "vector" | "hybrid";
      docId?: string;
    }) => Promise<{
      query: string;
      results: {
        blockId: string;
        citation: string;
        sectionHeading: string | null;
        pageNum: number;
        score: number;
        snippet: string;
        text: string;
      }[];
    }>;
  }).execute({
    query,
    limit: Math.max(1, Math.min(Number(values.limit), 25)),
    mode: values.mode as "auto" | "fts" | "vector" | "hybrid",
    docId: values["doc-id"],
  });

  console.log(`query:   "${result.query}"`);
  console.log(`mode:    ${values.mode}`);
  console.log(`results: ${result.results.length}\n`);

  result.results.forEach((hit, i) => {
    console.log(`${i + 1}. ${hit.citation}  (score ${hit.score.toFixed(3)})`);
    console.log(`   blockId: ${hit.blockId}`);
    console.log(`   snippet: ${hit.snippet.slice(0, 220).replace(/\n/g, " ")}`);
    console.log();
  });
}

export const searchCommand: Command = {
  name: "search",
  summary: "Run the production search-ref-docs tool against the corpus",
  usage: '"query"',
  options: [
    { flag: "--limit <n>", desc: "max results, 1–25 (default: 5)" },
    {
      flag: "--mode auto|fts|vector|hybrid",
      desc: "retrieval mode; auto runs hybrid, degrading to FTS when Ollama is unavailable (default: auto)",
    },
    { flag: "--doc-id <id>", desc: "restrict to one document, e.g. irs-1040-inst-2025" },
  ],
  run,
};
