// Invoke the search-ref-docs Mastra tool directly — same code path the review workflow
// uses during a review. Lets you eyeball what she'd see for a given query.
//
// Usage:
//   npx tsx scripts/searchRefDocs.ts "your query here"
//   npx tsx scripts/searchRefDocs.ts "single filing status" --limit 5
//   npx tsx scripts/searchRefDocs.ts "single filing status" --mode fts
//   npx tsx scripts/searchRefDocs.ts "single filing status" --doc-id irs-1040-inst-2025
//
// Mode options: auto | fts | vector | hybrid (default: auto, which picks
// hybrid+rerank when embeddings + Voyage key are present, else FTS-only).
import "dotenv/config";
import { parseArgs } from "node:util";
import { searchRefDocsTool } from "../src/mastra/tools/refDocs";

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      limit: { type: "string", default: "5" },
      mode: { type: "string", default: "auto" },
      "doc-id": { type: "string" },
    },
    allowPositionals: true,
  });
  const query = positionals.join(" ").trim();
  if (!query) {
    console.error('usage: npx tsx scripts/searchRefDocs.ts "your query" [--mode auto|fts|vector|hybrid] [--limit N] [--doc-id <id>]');
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
