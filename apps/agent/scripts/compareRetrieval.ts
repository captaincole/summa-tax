// Compare the same query across all three retrieval modes (FTS-only, vector-only,
// hybrid+rerank). Useful for understanding how each layer contributes.
//
// Usage:
//   npx tsx scripts/compareRetrieval.ts "your query here"
//   npx tsx scripts/compareRetrieval.ts                 # uses a default set
import "dotenv/config";
import { hybridSearchRefDocs } from "../src/mastra/db/refDocs";

const DEFAULT_QUERIES = [
  "filing status eligibility",
  "single filer never married",
  "household employee wages",
];

async function compareOne(query: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`QUERY: "${query}"`);
  console.log("=".repeat(70));

  // FTS and vector legs are run WITHOUT rerank so you see their raw rankings.
  // Hybrid runs WITH rerank — the production path.
  const variants = [
    { label: "FTS only (BM25, no rerank)", mode: "fts" as const, noRerank: true },
    { label: "VECTOR only (cosine, no rerank)", mode: "vector" as const, noRerank: true },
    { label: "HYBRID + RERANK (production path)", mode: "hybrid" as const, noRerank: false },
  ];

  for (const v of variants) {
    const r = await hybridSearchRefDocs({
      query,
      mode: v.mode,
      noRerank: v.noRerank,
      limit: 3,
    });
    console.log(`\n--- ${v.label} ---`);
    if (r.length === 0) {
      console.log("  (no hits)");
      continue;
    }
    r.forEach((h, i) =>
      console.log(
        `  ${i + 1}. p${h.pageNum} § ${h.sectionHeading ?? "(none)"} (score ${h.score.toFixed(3)})`,
      ),
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  const queries = args.length > 0 ? [args.join(" ")] : DEFAULT_QUERIES;
  for (const q of queries) await compareOne(q);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
